'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const taskRoutes = require('./routes/tasks');
const errorHandler = require('./middleware/errorHandler');
const metrics = require('./metrics');
const db = require('./db');

const app = express();

// Le tout premier middleware, avant helmet et avant le parsing du corps : le
// chrono doit demarrer au plus tot, et une requete rejetee par une couche
// intermediaire (corps trop volumineux, par exemple) doit etre comptee elle
// aussi. Une metrique qui ne voit que les requetes qui reussissent ne sert a
// rien le jour ou tout echoue.
app.use(metrics.middleware);

// Middleware
app.use(helmet());
app.use(cors());
// Premiere barriere contre les corps demesures : au-dela de 100 ko, express
// refuse avant meme que le JSON ne soit parse. La validation metier prend le
// relais ensuite, avec un message precis sur la longueur de description.
app.use(express.json({ limit: '100kb' }));

// Health check — « le serveur HTTP ecoute ».
//
// Volontairement inchange depuis le jour 1, et volontairement ignorant de la
// base. C'est lui que les deux sondes du pod interrogent, et c'est ce qui
// garantit qu'une base lente ne fait pas retirer les trois copies du Service en
// meme temps. Ce qu'il ne dit pas est desormais dit par /ready, juste dessous.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Readiness applicative — « la base repond, aussi ».
//
// LA DISTINCTION QUE LE JOUR 4 A RENDUE NECESSAIRE. /health repond ok tant que
// node ecoute ; celui-ci repond 503 des que Postgres ne repond plus. Les deux
// sont vrais en meme temps, et ce sont deux questions differentes :
//
//   /health -> « faut-il redemarrer ce conteneur ? »   (non, il ecoute)
//   /ready  -> « ce conteneur rend-il le service ? »   (non, il n'a pas de base)
//
// Il lit l'etat mis en cache par la surveillance de src/db.js : appeler cette
// route mille fois n'envoie pas mille requetes a Postgres.
app.get('/ready', (req, res) => {
  const etat = db.etatBase;
  const code = etat.joignable ? 200 : 503;
  res.status(code).json({
    status: etat.joignable ? 'ready' : 'degraded',
    base: etat.joignable ? 'joignable' : 'injoignable',
    // Le message d'erreur brut de pg est ce qui distingue « nom introuvable »
    // de « connexion refusee » de « mot de passe invalide ». Trois pannes
    // differentes, trois remedes differents.
    detail: etat.derniereErreur || undefined,
    verifieA: etat.derniereVerification,
  });
});

// La page que Prometheus vient lire toutes les cinq secondes. Du texte brut,
// jamais du JSON : c'est un format d'echange precis, et res.json() casserait
// le parsing cote Prometheus sans autre message qu'une cible "DOWN".
app.get('/metrics', async (req, res, next) => {
  try {
    await metrics.rafraichirJauge();
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  } catch (err) {
    next(err);
  }
});

// Routes
app.use('/api/tasks', taskRoutes);

// Route inconnue : du JSON, comme partout ailleurs sur cette API.
app.use((req, res) => res.status(404).json({ error: 'route introuvable' }));

// Error handling
app.use(errorHandler);

module.exports = app;

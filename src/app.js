'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const taskRoutes = require('./routes/tasks');
const errorHandler = require('./middleware/errorHandler');
const metrics = require('./metrics');

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
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

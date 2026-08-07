import express from 'express';
import pg from 'pg';
import { creerMesure } from '../../../partage/mesure.js';
import { demarrerLePouls } from '../../../partage/pouls.js';

const SERVICE = process.env.SERVICE || 'classement';
const PORT = Number(process.env.PORT || 3000);

// Meme regle que dans l'API : sans mot de passe, ce service ne peut rien faire
// d'utile, donc il refuse de demarrer plutot que de repondre 200 a vide.
if (!process.env.DB_PASSWORD) {
  console.error('[config] DB_PASSWORD est obligatoire et n\'est pas fourni, arret.');
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'grandline',
  max: 10,
  connectionTimeoutMillis: 3000,
});

let baseVivante = false;

// Le meme piege que celui trouve sur l'API, et il tue aussi surement ici : sans
// cette ligne, arreter la base ferait sortir le process en code 1 au lieu de le
// laisser degrader.
pool.on('error', (erreur) => {
  console.error('[db] connexion au repos perdue :', erreur.message);
  baseVivante = false;
});

const mesure = creerMesure(SERVICE);

// Le classement calcule, garde en memoire, recalcule a intervalle regulier.
//
// Ce cache n'est pas une optimisation gratuite : sans lui, chaque coup tire par
// la classe declencherait un GROUP BY sur toute la table des reponses, et le
// service tomberait bien avant d'avoir sature quoi que ce soit d'interessant.
// C'est aussi ce qui lui permet de repondre pendant que la base est coupee, avec
// des donnees qu'il annonce comme datees.
let classement = [];
let calculeLe = null;

async function recalculer() {
  try {
    const { rows } = await pool.query(`
      SELECT joueur,
             count(*) FILTER (WHERE juste)::int AS points,
             count(*)::int AS reponses
      FROM reponse
      GROUP BY joueur
      ORDER BY points DESC, min(donnee_le) ASC
      LIMIT 20
    `);
    classement = rows.map((ligne, rang) => ({ rang: rang + 1, ...ligne }));
    calculeLe = new Date().toISOString();
    baseVivante = true;
  } catch (erreur) {
    if (baseVivante) console.error('[classement] recalcul impossible :', erreur.message);
    baseVivante = false;
  }
  mesure.dependance.set({ dependance: 'base' }, baseVivante ? 1 : 0);
}

const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(mesure.mesurerRequetes);
mesure.brancherLaRoute(app);

app.get('/sante', (requete, reponse) => {
  reponse.status(baseVivante ? 200 : 503).json({
    service: SERVICE,
    version: process.env.VERSION || 'dev',
    etat: baseVivante ? 'ok' : 'degrade',
    dependances: { base: baseVivante },
  });
});

// Le classement reste servi meme quand la base est tombee, avec la date de son
// dernier calcul. C'est la degradation gracieuse appliquee ici : un classement
// vieux de trente secondes vaut mieux qu'une page blanche, a condition de dire
// qu'il est vieux.
app.get('/classement', (requete, reponse) => {
  reponse.json({ calcule_le: calculeLe, a_jour: baseVivante, classement });
});

// Un coup, c'est un vrai recalcul depuis la base. Il coute quelques
// millisecondes et il touche a l'etat reel du service, ce que le sujet demande.
app.get('/travail', async (requete, reponse) => {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM reponse WHERE juste',
  ).catch(() => ({ rows: null }));

  if (!rows) return reponse.status(503).json({ fait: false });
  mesure.coupsEncaisses.inc();
  reponse.json({ fait: true, bonnes_reponses: rows[0].n });
});

const serveur = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[classement] en ecoute sur le port ${PORT}`);
  demarrerLePouls();
});

recalculer();
setInterval(recalculer, 5000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[classement] ${signal} recu, arret en cours`);
    serveur.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}

import express from 'express';
import pg from 'pg';
import { creerMesure } from '../../../partage/mesure.js';
import { demarrerLePouls } from '../../../partage/pouls.js';
import { suivreLePavillon } from '../../../partage/pavillon.js';
import { demanderDesQuestions, questionValable, cleFournie } from './groq.js';

const SERVICE = process.env.SERVICE || 'vigie';
const PORT = Number(process.env.PORT || 3000);
const INTERVALLE_MS = Number(process.env.VIGIE_INTERVALLE_MS || 180000);

if (!process.env.DB_PASSWORD) {
  console.error('[config] DB_PASSWORD est obligatoire et n\'est pas fourni, arret.');
  process.exit(1);
}

// La cle du modele, elle, est optionnelle, et la difference est deliberee. Sans
// base, la vigie ne peut rien faire du tout. Sans cle, elle peut encore valider
// la reserve existante et repondre a la classe : la banque de depart de l'API
// suffit a faire tourner le quiz. Un service annexe qui refuserait de demarrer
// parce qu'un tiers est absent eteindrait un carre pour rien.
if (!cleFournie()) {
  console.warn('[config] GROQ_API_KEY absente : aucune question ne sera fabriquee, la reserve existante suffit au quiz');
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
pool.on('error', (erreur) => {
  console.error('[db] connexion au repos perdue :', erreur.message);
  baseVivante = false;
});

const mesure = creerMesure(SERVICE);

// Ce que la vigie sait d'elle-meme, et qu'elle rend sur /sante. C'est ce qui
// permettra de distinguer "la vigie est morte" de "le modele ne repond plus",
// deux choses que le carre au tableau affiche exactement pareil.
const journal = {
  fabriquees: 0,
  rejetees: 0,
  derniereTentative: null,
  dernierEchec: null,
};

async function fabriquerDesQuestions() {
  if (!cleFournie()) return;
  journal.derniereTentative = new Date().toISOString();
  try {
    const brutes = await demanderDesQuestions();
    for (const brute of brutes) {
      if (!questionValable(brute)) {
        journal.rejetees++;
        continue;
      }
      // Les questions fabriquees entrent en reserve NON validees. C'est
      // /travail qui les fait passer en jeu, une par une : le modele externe
      // propose, la vigie dispose.
      await pool.query(
        `INSERT INTO question (texte, propositions, bonne, origine, validee)
         VALUES ($1, $2, $3, 'vigie', FALSE)`,
        [brute.texte.trim(), JSON.stringify(brute.propositions), brute.bonne],
      );
      journal.fabriquees++;
    }
    journal.dernierEchec = null;
    console.log(`[vigie] reserve alimentee : ${journal.fabriquees} au total, ${journal.rejetees} rejetees`);
  } catch (erreur) {
    // On note et on continue. Le prochain passage retentera dans trois minutes,
    // et entre-temps le service reste parfaitement capable de repondre.
    journal.dernierEchec = erreur.message;
    console.error('[vigie] fabrication impossible :', erreur.message);
  }
}

const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(mesure.mesurerRequetes);
mesure.brancherLaRoute(app);

// La sonde ne regarde que la base. Le modele externe n'en fait volontairement
// pas partie : le declarer comme dependance ferait passer la vigie en 503 des
// que Groq a un hoquet, et le job de deploiement echouerait pour une raison qui
// ne nous appartient pas.
app.get('/sante', (requete, reponse) => {
  reponse.status(baseVivante ? 200 : 503).json({
    service: SERVICE,
    version: process.env.VERSION || 'dev',
    etat: baseVivante ? 'ok' : 'degrade',
    dependances: { base: baseVivante },
    modele: {
      cle_fournie: cleFournie(),
      derniere_tentative: journal.derniereTentative,
      dernier_echec: journal.dernierEchec,
      fabriquees: journal.fabriquees,
      rejetees: journal.rejetees,
    },
  });
});

app.get('/reserve', async (requete, reponse) => {
  try {
    const { rows } = await pool.query(`
      SELECT origine, validee, count(*)::int AS n
      FROM question GROUP BY origine, validee ORDER BY origine, validee
    `);
    reponse.json({ reserve: rows });
  } catch (erreur) {
    reponse.status(503).json({ raison: erreur.message });
  }
});

// Un coup, c'est la validation d'une question de la reserve.
//
// Volontairement, ce n'est PAS un appel au modele. La classe peut tirer trois
// cents coups par pouls : autant d'appels a un service externe brulerait le
// quota en une minute, et la mesure de saturation mesurerait la latence de Groq
// plutot que la notre. Ici, c'est une lecture et une ecriture en base, quelques
// millisecondes, et du travail qui compte vraiment.
app.get('/travail', async (requete, reponse) => {
  try {
    const { rows } = await pool.query(`
      UPDATE question SET validee = TRUE
      WHERE id = (
        SELECT id FROM question WHERE NOT validee
        ORDER BY creee_le LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);
    mesure.coupsEncaisses.inc();
    // Reserve vide, c'est un cas normal et pas une erreur : on repond 200 avec
    // zero validation. Repondre 503 ici ferait palir le carre alors que le
    // service fonctionne parfaitement.
    reponse.json({ fait: true, validee: rows[0]?.id ?? null });
  } catch (erreur) {
    reponse.status(503).json({ fait: false, raison: erreur.message });
  }
});

async function surveillerLaBase() {
  try {
    await pool.query('SELECT 1');
    baseVivante = true;
  } catch {
    baseVivante = false;
  }
  mesure.dependance.set({ dependance: 'base' }, baseVivante ? 1 : 0);
}

const serveur = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[vigie] en ecoute sur le port ${PORT}`);
  demarrerLePouls();
  // Ce service ne detient pas le pavillon : il va le chercher aupres de l'API
  // et en garde une copie locale, que le pouls relit a chaque battement.
  suivreLePavillon();
});

surveillerLaBase();
setInterval(surveillerLaBase, 5000).unref();

// La premiere fabrication attend dix secondes : au demarrage de la flotte, la
// base n'accepte pas encore de connexions, et un premier essai perdu retarderait
// la reserve de trois minutes pour rien.
setTimeout(fabriquerDesQuestions, 10000).unref();
setInterval(fabriquerDesQuestions, INTERVALLE_MS).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[vigie] ${signal} recu, arret en cours`);
    serveur.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}

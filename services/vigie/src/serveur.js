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
  doublons: 0,
};

// Une seule fabrication a la fois. Sans ce verrou, dix joueurs qui epuisent la
// banque en meme temps declencheraient dix appels au modele en parallele : on
// brulerait le quota et on paierait dix fois la meme latence. Les autres
// attendent celle qui est en cours et profitent de son resultat.
let fabricationEnCours = null;

async function fabriquerDesQuestions() {
  if (!cleFournie()) return 0;
  journal.derniereTentative = new Date().toISOString();
  let ajoutees = 0;
  try {
    const brutes = await demanderDesQuestions();
    for (const brute of brutes) {
      if (!questionValable(brute)) {
        journal.rejetees++;
        continue;
      }
      // Les questions fabriquees entrent VALIDEES.
      //
      // C'etait l'inverse au depart : elles attendaient qu'un coup du tableau
      // les valide une par une. Ca ne tient plus depuis que le jeu appelle la
      // vigie quand un joueur a epuise la banque : il attend sa question tout
      // de suite, pas au prochain tir de la classe.
      //
      // La validation n'a pas disparu pour autant, elle a change de place :
      // questionValable() ci-dessus refuse ce qui n'a pas quatre propositions
      // distinctes et une bonne reponse dans les clous. Le modele propose, la
      // vigie dispose, simplement plus tot.
      //
      // ON CONFLICT DO NOTHING : un modele qui tourne sur le meme sujet finit
      // toujours par se repeter, et la contrainte d'unicite sur le texte est
      // ce qui empeche un joueur de revoir la meme question dans sa serie.
      const insertion = await pool.query(
        `INSERT INTO question (texte, propositions, bonne, origine, validee)
         VALUES ($1, $2, $3, 'vigie', TRUE) ON CONFLICT DO NOTHING RETURNING id`,
        [brute.texte.trim(), JSON.stringify(brute.propositions), brute.bonne],
      );
      if (insertion.rows[0]) {
        journal.fabriquees++;
        ajoutees++;
      } else {
        journal.doublons++;
      }
    }
    journal.dernierEchec = null;
    publierEtatDuModele();
    console.log(`[vigie] ${ajoutees} question(s) ajoutee(s), ${journal.rejetees} rejetees, ${journal.doublons} doublons`);
  } catch (erreur) {
    // On note et on continue. Le service reste parfaitement capable de repondre.
    journal.dernierEchec = erreur.message;
    publierEtatDuModele();
    console.error('[vigie] fabrication impossible :', erreur.message);
  }
  return ajoutees;
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
      doublons: journal.doublons,
    },
  });
});

// La route que l'API appelle quand un joueur a epuise la banque.
//
// C'est ce qui fait que ce service n'est pas decoratif : si la vigie tombe, un
// joueur qui a tout repondu s'arrete la. Son carre au tableau a une consequence
// visible dans le jeu.
app.post('/fabriquer', async (requete, reponse) => {
  if (!cleFournie()) {
    return reponse.status(503).json({ ajoutees: 0, raison: 'aucune cle fournie' });
  }
  // Si une fabrication tourne deja, on attend la sienne au lieu d'en lancer une
  // autre.
  if (!fabricationEnCours) {
    fabricationEnCours = fabriquerDesQuestions().finally(() => { fabricationEnCours = null; });
  }
  const ajoutees = await fabricationEnCours;
  reponse.status(ajoutees > 0 ? 201 : 503).json({ ajoutees });
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
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE origine = 'vigie')::int AS fabriquees
      FROM question WHERE validee
    `);
    mesure.coupsEncaisses.inc();
    reponse.json({ fait: true, ...rows[0] });
  } catch (erreur) {
    reponse.status(503).json({ fait: false, raison: erreur.message });
  }
});

// Demande d'Amine en relecture : sortir l'etat du modele en metrique, et pas
// seulement dans le JSON de /sante.
//
// Sans ca, une vigie qui ne fabrique plus est invisible sur les panneaux. Son
// carre reste plein, sa dependance a la base va bien, et le seul signe est dans
// un champ que quelqu'un doit penser a aller lire. Depuis que le jeu appelle la
// vigie quand un joueur epuise la banque, ce silence bloque un joueur pour de
// vrai.
//
// Elle est declaree comme une dependance a part entiere, ce qui la fait
// apparaitre dans le panneau 3 sans qu'on touche a une seule requete.
function publierEtatDuModele() {
  const vivant = cleFournie() && !journal.dernierEchec;
  mesure.dependance.set({ dependance: 'modele' }, vivant ? 1 : 0);
}

async function surveillerLaBase() {
  try {
    await pool.query('SELECT 1');
    baseVivante = true;
  } catch {
    baseVivante = false;
  }
  mesure.dependance.set({ dependance: 'base' }, baseVivante ? 1 : 0);
  publierEtatDuModele();
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

'use strict';

const { Pool } = require('pg');
const config = require('./config');

// ---------------------------------------------------------------------------
// Chapitre 7, Mission A : plus une seule valeur en dur ici.
//
// Le chapitre 6 avait d'abord une IP (`172.17.0.2`), puis un nom de conteneur
// (`todo-postgres`) ecrits directement dans ce fichier, avec les identifiants a
// cote. Tout vient maintenant de la configuration, donc du .env, qui n'est
// jamais commite. Le meme code tourne en dev, en staging et en prod : seules
// les variables changent.
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  // Sans ce timeout, une base injoignable laisse la requete HTTP pendante
  // indefiniment cote client au lieu de renvoyer une erreur exploitable.
  connectionTimeoutMillis: 3000,
});

// Une erreur sur un client inactif du pool (la base qui tombe, par exemple)
// est emise sur le pool lui-meme. Sans ce handler, node considere l'evenement
// 'error' comme non gere et tue le process : l'API entiere disparait parce que
// la base a redemarre.
pool.on('error', (err) => {
  console.error('[db] erreur sur un client inactif du pool :', err.message);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id          UUID         PRIMARY KEY,
    description VARCHAR(500) NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'todo',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
  );
`;

// Postgres met quelques secondes a accepter les connexions au premier
// demarrage (initdb). On reessaie plutot que d'echouer sur le premier refus.
async function initSchema({ retries = 10, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query(SCHEMA);
      console.log('[db] schema pret');
      return;
    } catch (err) {
      console.warn(`[db] tentative ${attempt}/${retries} echouee : ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Jour 4 : savoir si la base repond, sans le demander a chaque fois.
//
// Le probleme que ceci resout est celui mesure en phase 7 : les deux sondes du
// pod interrogent /health, qui repond ok sans jamais toucher la base. Base
// coupee, les trois pods restent READY 1/1 pendant que /api/tasks renvoie 503.
//
// Et le piege de la correction naive : brancher les sondes sur un /health qui
// interroge Postgres a chaque appel. Avec une readinessProbe toutes les 5 s sur
// trois pods, une base qui ralentit un peu fait echouer les trois sondes en
// meme temps, le Service perd tous ses endpoints, et une base LENTE devient une
// application TOTALEMENT indisponible. On aurait echange un mensonge contre une
// panne.
//
// Le compromis retenu : une verification periodique, en fond, dont le resultat
// est mis en cache. Les lecteurs (l'endpoint /ready, la metrique todo_db_up)
// lisent le cache, ils n'interrogent jamais la base eux-memes. Le cout est donc
// d'UNE requete toutes les 10 secondes par pod, quel que soit le nombre de
// sondes et de scrapes.
// ---------------------------------------------------------------------------
const etatBase = {
  joignable: false,
  // null tant qu'aucune verification n'a eu lieu : "je ne sais pas encore" et
  // "la base est morte" ne sont pas la meme chose, et le dire evite d'alerter
  // sur les deux premieres secondes de vie d'un pod.
  derniereVerification: null,
  derniereErreur: null,
};

async function verifierBase() {
  try {
    // SELECT 1 et pas une vraie requete metier : on veut savoir si le pool
    // obtient une connexion et si Postgres repond, pas si une table existe.
    // Un timeout court, parce qu'une verification qui traine est elle-meme une
    // reponse — la base ne repond pas assez vite pour servir.
    await pool.query({ text: 'SELECT 1', query_timeout: 2000 });
    etatBase.joignable = true;
    etatBase.derniereErreur = null;
  } catch (err) {
    etatBase.joignable = false;
    etatBase.derniereErreur = err.message;
  }
  etatBase.derniereVerification = new Date();
  return etatBase;
}

let minuterie = null;

function demarrerSurveillanceBase({ intervalMs = 10000 } = {}) {
  if (minuterie) return minuterie;
  verifierBase();
  minuterie = setInterval(verifierBase, intervalMs);
  // unref : cette minuterie ne doit pas, a elle seule, empecher le process de
  // s'arreter. Sans ca, un SIGTERM laisserait node vivant jusqu'au SIGKILL.
  minuterie.unref();
  return minuterie;
}

function arreterSurveillanceBase() {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
}

module.exports = {
  pool,
  initSchema,
  etatBase,
  verifierBase,
  demarrerSurveillanceBase,
  arreterSurveillanceBase,
};

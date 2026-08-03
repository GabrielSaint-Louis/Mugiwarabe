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

module.exports = { pool, initSchema };

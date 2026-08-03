'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Chapitre 6, Mission A : la configuration est EN DUR, volontairement.
//
// `host` est l'IP interne du conteneur Postgres, relevee a la main avec :
//   docker inspect todo-postgres --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
//
// Cette IP est attribuee par le bridge par defaut, ou aucun nom n'est resolu.
// Elle change a chaque recreation du conteneur : c'est precisement la fragilite
// que la Mission B corrige avec un network custom, et que le chapitre 7 sortira
// completement du code.
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: '172.17.0.2',
  port: 5432,
  user: 'todo_user',
  password: 'todo_pass',
  database: 'todo_db',
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

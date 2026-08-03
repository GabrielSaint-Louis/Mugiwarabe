'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Chapitre 6, Mission B : plus aucune IP dans le code.
//
// `host` est desormais le NOM du conteneur Postgres. Il n'est resolvable que
// parce que les deux conteneurs partagent un network custom (todo-network), ou
// Docker fait tourner un DNS interne. Sur le bridge par defaut, ce meme nom ne
// resout rien du tout : il fallait y coller l'IP relevee au docker inspect, qui
// change a chaque recreation du conteneur.
//
// Les identifiants, eux, sont encore en dur : c'est le chapitre 7 qui les
// sortira du code via dotenv.
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: 'todo-postgres',
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

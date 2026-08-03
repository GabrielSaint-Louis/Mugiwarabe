'use strict';

const config = require('./config');
const app = require('./app');
const { pool, initSchema } = require('./db');

const server = app.listen(config.port, config.host, () => {
  console.log(`todo-api en ecoute sur http://${config.host}:${config.port}`);
  console.log(`environnement : ${config.nodeEnv}, base visee : ${config.db.host}:${config.db.port}`);
});

// On ecoute AVANT d'avoir la base : /health doit repondre meme si Postgres est
// encore en train de demarrer. Les routes qui touchent la base renverront une
// erreur claire en attendant, plutot que de laisser le conteneur pour mort.
initSchema().catch((err) => {
  console.error('[db] schema non initialise :', err.message);
});

// Le process est PID 1 dans le conteneur. Sans ces handlers, `docker stop`
// attend 10 secondes puis envoie un SIGKILL brutal.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} recu, arret en cours`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}

module.exports = server;

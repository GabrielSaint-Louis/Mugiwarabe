'use strict';

const app = require('./app');
const { pool, initSchema } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 et pas 127.0.0.1 : dans un conteneur, ecouter sur la loopback rend
// l'app injoignable depuis l'exterieur, meme avec le bon -p.
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`todo-api en ecoute sur http://${HOST}:${PORT}`);
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

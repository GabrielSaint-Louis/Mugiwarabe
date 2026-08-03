'use strict';

const app = require('./app');

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 et pas 127.0.0.1 : dans un conteneur, ecouter sur la loopback rend
// l'app injoignable depuis l'exterieur, meme avec le bon -p.
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`todo-api en ecoute sur http://${HOST}:${PORT}`);
});

// Le process est PID 1 dans le conteneur. Sans ces handlers, `docker stop`
// attend 10 secondes puis envoie un SIGKILL brutal.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} recu, arret en cours`);
    server.close(() => process.exit(0));
  });
}

module.exports = server;

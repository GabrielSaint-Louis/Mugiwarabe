import { config } from './config.js';
import { creerApp } from './app.js';
import { demarrerLePouls } from '../../../partage/pouls.js';

const app = creerApp();

const serveur = app.listen(config.port, config.host, () => {
  console.log(`[api] en ecoute sur http://${config.host}:${config.port}`);
  console.log(`[api] version ${config.version}`);

  // Le pouls demarre apres que le serveur ecoute, jamais avant. Il appelle la
  // route /travail du service par son URL interne : demarre trop tot, le
  // premier paquet de coups taperait sur un port ferme et serait perdu.
  demarrerLePouls();
});

// Le process est PID 1 dans le conteneur, donc c'est lui qui recoit le SIGTERM
// de docker stop. Sans ces gestionnaires, Docker attend dix secondes puis tue
// brutalement, et le carre reste allume au tableau pendant tout ce temps.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[api] ${signal} recu, arret en cours`);
    serveur.close(() => process.exit(0));
  });
}

import { config } from './config.js';
import { creerApp } from './app.js';
import { attendreLaBase, initialiserSchema, surveillerLaBase, pool } from './db.js';
import { semerLaBanque } from './quiz.js';
import { demarrerLePouls } from '../../../partage/pouls.js';

const app = creerApp();

const serveur = app.listen(config.port, config.host, () => {
  console.log(`[api] en ecoute sur http://${config.host}:${config.port}`);
  console.log(`[api] version ${config.version}`);

  // Le pouls demarre des que le serveur ecoute, sans attendre la base. C'est
  // volontaire : le carre doit s'allumer, et la sonde de sante dira ensuite que
  // le service tourne sans pouvoir travailler. Attendre la base ici laisserait
  // le carre eteint, ce qui raconterait une panne plus grave que la realite.
  demarrerLePouls();
});

// On ecoute AVANT d'avoir la base, mais on prepare quand meme le terrain. Si
// elle ne repond pas au bout d'une minute, on continue de servir : la route de
// sante repondra 503 et le tableau de bord le montrera, ce qui vaut mieux qu'un
// conteneur qui boucle en redemarrage sans rien dire.
(async () => {
  if (!(await attendreLaBase())) {
    console.error('[api] la base ne repond toujours pas, on sert quand meme en degrade');
    return;
  }
  await initialiserSchema();
  await semerLaBanque();
  surveillerLaBase();
})().catch((erreur) => {
  console.error('[api] preparation de la base impossible :', erreur.message);
});

// Le process est PID 1 dans le conteneur, donc c'est lui qui recoit le SIGTERM
// de docker stop. Sans ces gestionnaires, Docker attend dix secondes puis tue
// brutalement, et le carre reste allume au tableau pendant tout ce temps.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[api] ${signal} recu, arret en cours`);
    serveur.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  });
}

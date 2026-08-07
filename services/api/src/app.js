import express from 'express';
import { config } from './config.js';
import { register, mesurerRequetes } from './metrics.js';

export function creerApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(mesurerRequetes);

  // La route de sante. Pour l'instant elle ne prouve qu'une chose : le serveur
  // HTTP tourne. C'est deja ce que le pouls prouve, donc elle ne vaut pas
  // grand-chose. La phase 6 lui donnera de quoi mentir moins : elle ira
  // vraiment interroger la base avant de repondre.
  app.get('/sante', (requete, reponse) => {
    reponse.json({
      service: config.service,
      version: config.version,
      etat: 'ok',
    });
  });

  // La route que le pouls frappe quand la classe tire. Elle est vide pour
  // l'instant, mais elle doit exister des maintenant : le pouls l'appelle sans
  // savoir si on l'a ecrite, et un 404 compterait comme un coup non encaisse.
  // Au palier 4, elle fera un vrai travail qui coute quelques millisecondes.
  app.get('/travail', (requete, reponse) => {
    reponse.json({ fait: true });
  });

  app.get('/metriques', async (requete, reponse) => {
    reponse.set('Content-Type', register.contentType);
    reponse.end(await register.metrics());
  });

  return app;
}

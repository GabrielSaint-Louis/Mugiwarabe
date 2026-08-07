import express from 'express';
import { config } from './config.js';
import { register, mesurerRequetes, coupsEncaisses } from './metrics.js';
import { etatBase, interrogerLaBase, pool } from './db.js';
import { mancheCourante, ouvrirUneManche, repondre } from './quiz.js';
import { lire as lirePavillon, hisser } from './pavillon.js';

export function creerApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(mesurerRequetes);

  // --- La sonde ------------------------------------------------------------
  //
  // Elle ne se contente pas de repondre 200 parce que le serveur tourne : ca,
  // le pouls le prouve deja. Elle va vraiment interroger la base, parce que
  // c'est la difference entre "le service repond" et "le service fonctionne".
  //
  // 503 et pas 500 : le service n'est pas casse, sa dependance a disparu. Le
  // code de statut fait partie du diagnostic, autant qu'il soit juste.
  app.get('/sante', async (requete, reponse) => {
    const base = await interrogerLaBase();
    reponse.status(base ? 200 : 503).json({
      service: config.service,
      version: config.version,
      etat: base ? 'ok' : 'degrade',
      dependances: { base },
    });
  });

  // --- La route qui encaisse les coups -------------------------------------
  //
  // Un coup doit couter quelque chose de reel, sinon la mesure de saturation ne
  // mesure rien. Celui-ci lit la manche ouverte et compte ses reponses : une
  // jointure et un agregat, quelques millisecondes, et ca touche vraiment a
  // l'etat du service.
  app.get('/travail', async (requete, reponse) => {
    try {
      const { rows } = await pool.query(`
        SELECT count(*)::int AS reponses, count(*) FILTER (WHERE juste)::int AS justes
        FROM reponse r JOIN manche m ON m.id = r.manche_id
        WHERE m.fermee_le IS NULL
      `);
      coupsEncaisses.inc();
      reponse.json({ fait: true, ...rows[0] });
    } catch (erreur) {
      // 503 : le coup n'a pas ete encaisse. Repondre 200 ici gonflerait le
      // compteur du tableau avec du travail qui n'a jamais eu lieu, et le carre
      // resterait plein pendant que la base est morte.
      reponse.status(503).json({ fait: false, raison: erreur.message });
    }
  });

  // --- Le quiz --------------------------------------------------------------
  app.get('/manche', async (requete, reponse) => {
    const manche = await mancheCourante();
    if (!manche) return reponse.status(404).json({ raison: 'aucune manche ouverte' });
    reponse.json(manche);
  });

  app.post('/manche', async (requete, reponse) => {
    const manche = await ouvrirUneManche();
    if (!manche) return reponse.status(409).json({ raison: 'aucune question validee en reserve' });
    reponse.status(201).json(manche);
  });

  app.post('/reponse', async (requete, reponse) => {
    const { manche_id: mancheId, joueur, choix } = requete.body || {};
    if (!mancheId || !joueur || !Number.isInteger(choix)) {
      return reponse.status(400).json({ raison: 'manche_id, joueur et choix sont attendus' });
    }
    const resultat = await repondre(mancheId, String(joueur).slice(0, 40), choix);
    reponse.status(resultat.accepte ? 201 : 409).json(resultat);
  });

  // --- Le pavillon ----------------------------------------------------------
  //
  // L'API est le seul service qui l'ecrit. Les trois autres viennent le lire ici
  // et en gardent une copie locale : sur le cluster, un volume monte par
  // plusieurs pods a la fois demanderait du ReadWriteMany, que k3d ne garantit
  // pas. Passer par HTTP donne le meme comportement dans les deux mondes.
  app.post('/pavillon', (requete, reponse) => {
    const resultat = hisser(requete.body?.pavillon ?? requete.body?.texte);
    if (!resultat.ok) return reponse.status(400).json({ raison: resultat.raison });
    console.log(`[pavillon] hisse : ${resultat.pavillon}`);
    reponse.status(201).json({ pavillon: resultat.pavillon });
  });

  app.get('/pavillon', (requete, reponse) => {
    reponse.json({ pavillon: lirePavillon() });
  });

  app.get('/metriques', async (requete, reponse) => {
    reponse.set('Content-Type', register.contentType);
    reponse.end(await register.metrics());
  });

  // Le dernier filet. Sans lui, une promesse rejetee dans une route asynchrone
  // laisse la requete sans reponse : le client attend son timeout, et la
  // latence explose sans qu'aucune erreur n'apparaisse nulle part.
  app.use((erreur, requete, reponse, suite) => {
    console.error(`[api] ${requete.method} ${requete.path} :`, erreur.message);
    reponse.status(500).json({ raison: 'erreur interne' });
  });

  return app;
}

export { etatBase };

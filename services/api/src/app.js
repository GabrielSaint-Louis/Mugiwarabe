import express from 'express';
import { config } from './config.js';
import { creerMesure } from '../../../partage/mesure.js';
import { etatBase, interrogerLaBase, pool } from './db.js';
import { commencerUnePartie, etatDeLaPartie, repondre, inscrireAuClassement, compterLesParties, SECONDES_PAR_QUESTION } from './quiz.js';
import { lire as lirePavillon, hisser } from './pavillon.js';

// Le registre de l'API vient du meme fabricant que celui des trois autres
// services. Il avait son propre fichier avant que la mesure ne soit mise en
// commun : deux registres auraient derive, et le panneau de latence aurait
// compare des tranches d'histogramme differentes.
export const mesure = creerMesure(config.service);

export function creerApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(mesure.mesurerRequetes);

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
    // La sonde et la metrique disent la meme chose au meme moment. Les laisser
    // se desynchroniser reviendrait a avoir un panneau vert pendant qu'un
    // service repond 503, et c'est exactement le genre d'ecart qui fait perdre
    // dix minutes en pleine demonstration.
    mesure.dependance.set({ dependance: 'base' }, base ? 1 : 0);
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
      const compte = await compterLesParties();
      mesure.coupsEncaisses.inc();
      reponse.json({ fait: true, ...compte });
    } catch (erreur) {
      // 503 : le coup n'a pas ete encaisse. Repondre 200 ici gonflerait le
      // compteur du tableau avec du travail qui n'a jamais eu lieu, et le carre
      // resterait plein pendant que la base est morte.
      reponse.status(503).json({ fait: false, raison: erreur.message });
    }
  });

  // --- Le quiz --------------------------------------------------------------
  //
  // Une partie, c'est la serie d'un joueur : il repond tant qu'il ne se trompe
  // pas. Rien n'est synchronise entre les joueurs, chacun avance a son rythme.
  //
  // La bonne reponse ne sort jamais d'ici tant que la partie est en cours : le
  // front la recevrait, et n'importe qui ouvrant les outils de developpement
  // verrait la solution avant de repondre.
  app.post('/partie', async (requete, reponse) => {
    const partie = await commencerUnePartie();
    if (!partie.question) {
      return reponse.status(503).json({ raison: 'aucune question disponible' });
    }
    reponse.status(201).json({ ...partie, secondes: SECONDES_PAR_QUESTION });
  });

  app.get('/partie/:jeton', async (requete, reponse) => {
    const partie = await etatDeLaPartie(requete.params.jeton);
    if (!partie) return reponse.status(404).json({ raison: 'partie inconnue' });
    reponse.json({
      serie: partie.serie,
      en_cours: partie.en_cours,
      fin: partie.fin,
      joueur: partie.joueur,
      secondes_restantes: partie.secondes_restantes,
      question: partie.en_cours && partie.question_id
        ? { id: partie.question_id, texte: partie.texte, propositions: partie.propositions, origine: partie.origine }
        : null,
    });
  });

  app.post('/partie/:jeton/reponse', async (requete, reponse) => {
    const choix = requete.body?.choix;
    if (!Number.isInteger(choix) || choix < 0 || choix > 3) {
      return reponse.status(400).json({ raison: 'choix attendu, entre 0 et 3' });
    }
    const resultat = await repondre(requete.params.jeton, choix);
    if (resultat.erreur) return reponse.status(409).json(resultat);
    reponse.json(resultat);
  });

  // Le nom n'est demande qu'a la fin, quand il y a quelque chose a inscrire.
  app.post('/partie/:jeton/nom', async (requete, reponse) => {
    const resultat = await inscrireAuClassement(requete.params.jeton, requete.body?.joueur);
    reponse.status(resultat.ok ? 201 : 400).json(resultat);
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

  mesure.brancherLaRoute(app);

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

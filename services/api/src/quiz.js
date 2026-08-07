import crypto from 'node:crypto';
import { pool } from './db.js';

// Le temps laisse pour repondre. Il est verifie cote serveur, a partir de
// l'heure ou la question a ete servie : un compte a rebours qui ne vivrait que
// dans le navigateur se falsifierait en changeant l'horloge de son telephone.
export const SECONDES_PAR_QUESTION = Number(process.env.SECONDES_PAR_QUESTION || 15);

// Deux secondes de marge sur le chronometre du serveur. Elles couvrent le temps
// d'aller-retour reseau : sans elles, quelqu'un qui repond a la quatorzieme
// seconde depuis un telephone en 4G perdrait une serie a cause de sa latence, et
// pas de sa reponse.
const MARGE_RESEAU_S = 2;

const VIGIE = process.env.VIGIE_URL || 'http://vigie:3000';

// La banque de depart. Elle existe pour que le jeu tourne meme si la vigie n'a
// jamais rien produit : un service annexe qui depend d'un tiers ne doit pas
// pouvoir vider le jeu.
const BANQUE = [
  ['Quelle commande affiche les couches d\'une image Docker ?', ['docker layers', 'docker history', 'docker inspect --layers', 'docker image tree'], 1],
  ['Que garde un volume Docker quand le conteneur est remplace ?', ['rien', 'les logs', 'les donnees ecrites dedans', 'les variables d\'environnement'], 2],
  ['Dans un Dockerfile multi-stage, a quoi sert le premier etage ?', ['a exposer les ports', 'a construire, puis a etre jete', 'a definir l\'utilisateur', 'a lancer les tests'], 1],
  ['Que fait restart: unless-stopped ?', ['relance le conteneur sauf si on l\'a arrete soi-meme', 'empeche tout redemarrage', 'relance seulement au boot', 'relance a chaque deploiement'], 0],
  ['Une route de sante qui repond 200 prouve que...', ['la base est joignable', 'le serveur HTTP tourne', 'le deploiement a reussi', 'les dependances vont bien'], 1],
  ['Pourquoi taguer une image avec le sha du commit ?', ['pour gagner de la place', 'pour savoir exactement quel code tourne', 'pour aller plus vite', 'c\'est impose par Docker'], 1],
  ['Qu\'est-ce qu\'un deploiement idempotent ?', ['il ne peut etre lance qu\'une fois', 'le rejouer ne casse rien', 'il est plus rapide la deuxieme fois', 'il ne touche pas a la base'], 1],
  ['Que veut dire degrader gracieusement ?', ['tomber proprement', 'rendre la partie du service qui marche encore', 'redemarrer automatiquement', 'afficher une erreur claire'], 1],
  ['Pourquoi un histogramme plutot qu\'une moyenne pour la latence ?', ['c\'est plus joli', 'la moyenne masque les requetes lentes', 'ca prend moins de place', 'Prometheus l\'impose'], 1],
  ['Un service qui expose un port fixe peut-il etre duplique ?', ['oui, toujours', 'non, deux conteneurs ne peuvent pas ecouter le meme port de la machine', 'oui, si l\'image est la meme', 'seulement sur un cluster'], 1],
  ['A quoi sert maxUnavailable a 0 dans un rolling update ?', ['a aller plus vite', 'a interdire de retirer un pod avant que son remplacant soit pret', 'a limiter la memoire', 'a desactiver les sondes'], 1],
  ['Quelle difference entre une sonde readiness et une sonde liveness ?', ['aucune', 'readiness decide du trafic, liveness decide du redemarrage', 'liveness est plus rapide', 'readiness ne sert qu\'au demarrage'], 1],
];

export async function semerLaBanque() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM question');
  if (rows[0].n > 0) return 0;

  for (const [texte, propositions, bonne] of BANQUE) {
    await pool.query(
      `INSERT INTO question (texte, propositions, bonne, origine, validee)
       VALUES ($1, $2, $3, 'banque', TRUE) ON CONFLICT DO NOTHING`,
      [texte, JSON.stringify(propositions), bonne],
    );
  }
  console.log(`[quiz] banque de depart semee : ${BANQUE.length} questions`);
  return BANQUE.length;
}

// --- Servir une question -----------------------------------------------------

// Tire une question que cette partie n'a pas encore vue, la marque comme vue, et
// note l'heure a laquelle elle a ete servie. Le tout en une seule requete : deux
// appels simultanes sur la meme partie ne peuvent pas servir deux questions
// differentes et laisser le joueur repondre a celle qui l'arrange.
async function servirUneQuestion(partieId) {
  const { rows } = await pool.query(`
    WITH tiree AS (
      SELECT q.id FROM question q
      WHERE q.validee
        AND NOT EXISTS (SELECT 1 FROM partie_vue v WHERE v.partie_id = $1 AND v.question_id = q.id)
      ORDER BY random() LIMIT 1
    ), marquee AS (
      INSERT INTO partie_vue (partie_id, question_id) SELECT $1, id FROM tiree RETURNING question_id
    ), maj AS (
      UPDATE partie SET question_id = (SELECT question_id FROM marquee), servie_le = now()
      WHERE id = $1 AND EXISTS (SELECT 1 FROM marquee) RETURNING question_id
    )
    SELECT q.id, q.texte, q.propositions, q.origine
    FROM question q JOIN maj ON maj.question_id = q.id
  `, [partieId]);
  return rows[0] || null;
}

// Demande des questions neuves a la vigie.
//
// L'API ne parle pas au modele elle-meme, et c'est deliberate : chaque service
// garde son territoire. La consequence est visible au tableau, et c'est ce qui
// rend le carre de la vigie utile plutot que decoratif. Si elle tombe, un joueur
// qui a epuise la banque le voit tout de suite.
async function demanderDesQuestionsNeuves() {
  try {
    const reponse = await fetch(`${VIGIE}/fabriquer`, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
    });
    if (!reponse.ok) return 0;
    const { ajoutees } = await reponse.json();
    return ajoutees || 0;
  } catch (erreur) {
    console.error('[quiz] la vigie n\'a pas pu fabriquer :', erreur.message);
    return 0;
  }
}

export async function commencerUnePartie() {
  const jeton = crypto.randomBytes(16).toString('hex');
  const { rows } = await pool.query(
    'INSERT INTO partie (jeton) VALUES ($1) RETURNING id, jeton',
    [jeton],
  );
  const question = await servirUneQuestion(rows[0].id);
  return { jeton: rows[0].jeton, question, serie: 0 };
}

export async function etatDeLaPartie(jeton) {
  const { rows } = await pool.query(`
    SELECT p.id, p.jeton, p.serie, p.en_cours, p.joueur, p.fin, p.servie_le,
           q.id AS question_id, q.texte, q.propositions, q.origine,
           GREATEST(0, $2 - EXTRACT(EPOCH FROM (now() - p.servie_le)))::int AS secondes_restantes
    FROM partie p LEFT JOIN question q ON q.id = p.question_id
    WHERE p.jeton = $1
  `, [jeton, SECONDES_PAR_QUESTION]);
  return rows[0] || null;
}

// --- Repondre ----------------------------------------------------------------

export async function repondre(jeton, choix) {
  const partie = await etatDeLaPartie(jeton);
  if (!partie) return { erreur: 'partie inconnue' };
  if (!partie.en_cours) return { erreur: 'partie terminee', serie: partie.serie };

  // Le temps est verifie ici, a partir de l'heure de service enregistree en
  // base. C'est la seule facon d'avoir un chronometre qui ne se falsifie pas.
  const ecoule = (Date.now() - new Date(partie.servie_le).getTime()) / 1000;
  if (ecoule > SECONDES_PAR_QUESTION + MARGE_RESEAU_S) {
    await terminer(partie.id, 'temps ecoule');
    return { juste: false, fini: true, fin: 'temps ecoule', serie: partie.serie };
  }

  const { rows } = await pool.query('SELECT bonne FROM question WHERE id = $1', [partie.question_id]);
  const juste = Boolean(rows[0]) && rows[0].bonne === choix;

  if (!juste) {
    await terminer(partie.id, 'mauvaise reponse');
    return { juste: false, fini: true, fin: 'mauvaise reponse', serie: partie.serie, bonne: rows[0]?.bonne };
  }

  const maj = await pool.query(
    'UPDATE partie SET serie = serie + 1 WHERE id = $1 RETURNING serie',
    [partie.id],
  );
  const serie = maj.rows[0].serie;

  // La question suivante. Si la banque est epuisee pour ce joueur, on demande a
  // la vigie d'en fabriquer, et on retente une fois.
  let question = await servirUneQuestion(partie.id);
  let fabriquees = 0;

  if (!question) {
    fabriquees = await demanderDesQuestionsNeuves();
    if (fabriquees > 0) question = await servirUneQuestion(partie.id);
  }

  if (!question) {
    // Banque epuisee et vigie incapable de fabriquer. Ce n'est PAS une defaite :
    // le joueur a repondu juste a tout ce qui existe. On valide son score.
    await terminer(partie.id, 'banque epuisee');
    return { juste: true, fini: true, fin: 'banque epuisee', serie };
  }

  return { juste: true, fini: false, serie, question, fabriquees };
}

async function terminer(partieId, fin) {
  await pool.query(
    'UPDATE partie SET en_cours = FALSE, terminee_le = now(), fin = $2 WHERE id = $1',
    [partieId, fin],
  );
}

// Le nom n'est demande qu'a la fin, quand il y a quelque chose a inscrire.
// Demander un pseudo avant de jouer produit des identites vides qui n'ont jamais
// rien fait, et un classement de pseudos aleatoires ne veut rien dire.
export async function inscrireAuClassement(jeton, joueur) {
  const propre = String(joueur || '').trim().slice(0, 24);
  if (propre.length < 2) return { ok: false, raison: 'deux caracteres au minimum' };

  const { rows } = await pool.query(
    `UPDATE partie SET joueur = $2
     WHERE jeton = $1 AND NOT en_cours AND joueur IS NULL
     RETURNING serie, fin`,
    [jeton, propre],
  );
  if (!rows[0]) return { ok: false, raison: 'partie inconnue, encore en cours, ou deja inscrite' };
  return { ok: true, joueur: propre, ...rows[0] };
}

// Le travail que la route /travail fait vraiment : un comptage sur les parties
// en cours. Une lecture agregee sur deux tables, quelques millisecondes, et ca
// touche a l'etat reel du service.
export async function compterLesParties() {
  const { rows } = await pool.query(`
    SELECT count(*) FILTER (WHERE en_cours)::int AS en_cours,
           count(*) FILTER (WHERE joueur IS NOT NULL)::int AS inscrites,
           COALESCE(max(serie), 0)::int AS meilleure_serie
    FROM partie
  `);
  return rows[0];
}

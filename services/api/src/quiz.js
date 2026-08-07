import { pool } from './db.js';

// La banque de depart. Elle existe pour une raison precise : la vigie fabrique
// des questions en parlant a un modele externe, et un service annexe qui ne
// repond plus parce qu'un tiers est tombe eteindrait un carre pour rien. Avec
// cette banque, le quiz tourne meme si la vigie n'a jamais rien produit.
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
];

export async function semerLaBanque() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM question');
  if (rows[0].n > 0) return 0;

  for (const [texte, propositions, bonne] of BANQUE) {
    await pool.query(
      'INSERT INTO question (texte, propositions, bonne, origine, validee) VALUES ($1, $2, $3, $4, TRUE)',
      [texte, JSON.stringify(propositions), bonne, 'banque'],
    );
  }
  console.log(`[quiz] banque de depart semee : ${BANQUE.length} questions`);
  return BANQUE.length;
}

// La manche ouverte, avec sa question. La bonne reponse ne sort jamais d'ici :
// le front la recevrait, et n'importe qui ouvrant les outils de developpement
// verrait la solution avant de repondre.
export async function mancheCourante() {
  const { rows } = await pool.query(`
    SELECT m.id, m.ouverte_le, q.texte, q.propositions
    FROM manche m JOIN question q ON q.id = m.question_id
    WHERE m.fermee_le IS NULL
    ORDER BY m.ouverte_le DESC LIMIT 1
  `);
  return rows[0] || null;
}

export async function ouvrirUneManche() {
  // Une seule requete qui ferme les manches ouvertes et en ouvre une nouvelle
  // sur une question tiree au hasard. Passer par deux allers-retours laisserait
  // une fenetre ou deux exemplaires de l'API ouvriraient chacun leur manche.
  const { rows } = await pool.query(`
    WITH fermeture AS (
      UPDATE manche SET fermee_le = now() WHERE fermee_le IS NULL RETURNING 1
    ), tirage AS (
      SELECT id FROM question WHERE validee ORDER BY random() LIMIT 1
    )
    INSERT INTO manche (question_id) SELECT id FROM tirage RETURNING id
  `);
  return rows[0] || null;
}

export async function repondre(mancheId, joueur, choix) {
  const { rows } = await pool.query(
    `SELECT q.bonne FROM manche m JOIN question q ON q.id = m.question_id
     WHERE m.id = $1 AND m.fermee_le IS NULL`,
    [mancheId],
  );
  if (!rows[0]) return { accepte: false, raison: 'manche fermee ou inconnue' };

  const juste = rows[0].bonne === choix;
  // ON CONFLICT DO NOTHING : la contrainte d'unicite decide, pas le code. Deux
  // requetes simultanees du meme joueur ne peuvent pas passer toutes les deux.
  const insertion = await pool.query(
    `INSERT INTO reponse (manche_id, joueur, choix, juste) VALUES ($1, $2, $3, $4)
     ON CONFLICT (manche_id, joueur) DO NOTHING RETURNING id`,
    [mancheId, joueur, choix, juste],
  );
  if (!insertion.rows[0]) return { accepte: false, raison: 'deja repondu a cette manche' };
  return { accepte: true, juste };
}

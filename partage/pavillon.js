// La diffusion du pavillon aux services qui ne le detiennent pas.
//
// Le pouls relit le pavillon sur le disque a chaque battement. Un seul service
// le detient, l'API, parce qu'un seul doit pouvoir l'ecrire. Restait a savoir
// comment les trois autres le connaissent, et il y avait deux facons de faire.
//
// La premiere : monter le meme volume en lecture seule sur les quatre services.
// Deux lignes de compose, zero code. Elle marche parfaitement aujourd'hui, et
// elle casse au palier 7 : sur le cluster, un volume monte par plusieurs pods a
// la fois demande du ReadWriteMany, que k3d ne garantit pas. On aurait eu a
// reecrire ce mecanisme en fin de journee, au pire moment.
//
// La seconde, celle-ci : chaque service demande le pavillon a l'API et en garde
// une copie locale, hors du volume. Un peu de code, et le meme comportement sur
// le compose comme sur le cluster.
//
// La copie locale a une deuxieme vertu, decouverte en y reflechissant : si l'API
// tombe, les trois autres continuent de declarer le pavillon qu'ils ont deja.
// Le pavillon ne clignote pas au tableau parce qu'un service est en train de
// redemarrer.
import fs from 'node:fs';
import path from 'node:path';

const FICHIER = process.env.PAVILLON_FICHIER || '/data/pavillon.txt';
const SOURCE = process.env.PAVILLON_SOURCE || '';
const INTERVALLE_MS = Number(process.env.PAVILLON_INTERVALLE_MS || 30000);

async function recuperer() {
  try {
    const reponse = await fetch(SOURCE, { signal: AbortSignal.timeout(2000) });
    if (!reponse.ok) return;
    const { pavillon } = await reponse.json();
    if (typeof pavillon !== 'string') return;

    // On n'ecrit que si le contenu a change. Sans ce test, on reecrirait le
    // meme fichier toutes les trente secondes pendant toute la journee, pour
    // rien.
    const actuel = fs.existsSync(FICHIER) ? fs.readFileSync(FICHIER, 'utf8') : null;
    if (actuel === pavillon) return;

    fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
    fs.writeFileSync(FICHIER, pavillon, 'utf8');
    console.log('[pavillon] mis a jour depuis la source');
  } catch (erreur) {
    // Silencieux et sans consequence. L'API peut etre en train de redemarrer :
    // on garde la copie qu'on a, le pouls continue de la declarer, et on
    // reessaiera dans trente secondes.
    console.error('[pavillon] source injoignable :', erreur.message);
  }
}

// Les premiers essais sont rapproches, et ce n'est pas de la coquetterie : ce
// reglage a ete ajoute apres avoir vu le pavillon disparaitre pour de vrai.
//
// Au redeploiement, les cinq conteneurs repartent ensemble. Un service qui
// demande le pavillon a la premiere seconde tombe sur une API qui n'ecoute pas
// encore. Avec un seul intervalle de trente secondes, il declarait donc un
// pavillon vide pendant une demi-minute, et le sujet demande qu'il soit au
// tableau quinze secondes apres un push.
//
// C'est exactement le piege annonce par le sujet, sauf qu'il ne vient pas de
// l'endroit ou le fichier est ecrit : le volume avait parfaitement fait son
// travail. Il vient du moment ou on va le chercher.
const ESSAIS_RAPPROCHES_MS = [0, 2000, 5000, 10000];

export function suivreLePavillon() {
  if (!SOURCE) {
    console.warn('[pavillon] PAVILLON_SOURCE absente : ce service ne declarera que ce qu\'il a deja sur son disque');
    return;
  }

  for (const delai of ESSAIS_RAPPROCHES_MS) {
    setTimeout(recuperer, delai).unref();
  }
  setInterval(recuperer, INTERVALLE_MS).unref();
}

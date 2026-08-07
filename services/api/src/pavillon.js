import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const LONGUEUR_MAX = 140;

export function lire() {
  try {
    return fs.readFileSync(config.pavillonFichier, 'utf8').trim();
  } catch {
    return '';
  }
}

export function hisser(texte) {
  const propre = String(texte ?? '').trim();
  if (!propre) return { ok: false, raison: 'le pavillon ne peut pas etre vide' };
  if (propre.length > LONGUEUR_MAX) {
    return { ok: false, raison: `${LONGUEUR_MAX} caracteres au maximum, recu ${propre.length}` };
  }

  // Le dossier parent doit exister. Il est cree dans l'image et le volume en
  // herite, mais un volume recree a la main pendant la journee arriverait vide :
  // autant que le premier POST le repare au lieu d'echouer.
  fs.mkdirSync(path.dirname(config.pavillonFichier), { recursive: true });

  // Ecriture atomique : on ecrit a cote, puis on renomme. Un rename sur le meme
  // systeme de fichiers est atomique, donc le pouls qui relit le fichier au meme
  // moment tombe soit sur l'ancien pavillon, soit sur le nouveau, jamais sur un
  // fichier a moitie ecrit. Sans ca, un pouls malchanceux declarerait un
  // pavillon tronque, et la classe le verrait a l'ecran.
  const provisoire = `${config.pavillonFichier}.nouveau`;
  fs.writeFileSync(provisoire, propre, 'utf8');
  fs.renameSync(provisoire, config.pavillonFichier);

  return { ok: true, pavillon: propre };
}

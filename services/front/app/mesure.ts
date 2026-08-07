import { creerMesure } from '../../../partage/mesure.js';

// Une seule instance pour tout le process.
//
// Next charge chaque route dans le meme process mais chaque module y garde son
// etat. Appeler creerMesure() dans /metriques ET dans /sante creerait deux
// registres : celui qu'on expose ne contiendrait jamais ce que l'autre a
// mesure, et le panneau des dependances resterait desesperement vide.
export const mesure = creerMesure(process.env.SERVICE || 'front');

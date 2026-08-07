import { NextResponse } from 'next/server';
import { appeler, dependanceCoupee } from '../disjoncteur';
import { mesure } from '../mesure';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';

// La route qui encaisse les coups.
//
// Le travail du front, c'est de composer une page : aller chercher la manche
// ouverte et l'assembler. C'est ce que fait un coup ici, et ca traverse
// vraiment le reseau interne.
//
// Elle repond 200 meme quand l'API ne repond pas, et c'est voulu : le coup a
// bien ete encaisse, le front a bien fait son travail, qui est de rendre une
// page. Repondre 503 ferait palir le carre du front pour une panne qui est
// ailleurs, exactement ce que le sujet demande d'eviter.
//
// Le disjoncteur est ce qui rend cette promesse tenable sous les salves : sans
// lui, chaque coup payait deux secondes de delai et le retard s'accumulait
// jusqu'a faire palir le carre quand meme.
export async function GET() {
  const debut = Date.now();
  const manche = await appeler<{ id: number }>('api', `${API}/manche`);

  // Le coup est compte meme quand l'API n'a pas repondu : le front a bien fait
  // son travail, qui est de rendre une page. C'est la meme logique que le 200
  // renvoye plus bas.
  mesure.coupsEncaisses.inc();
  mesure.dependance.set({ dependance: 'api' }, manche === null ? 0 : 1);

  return NextResponse.json({
    fait: true,
    degrade: manche === null,
    disjoncteur_ouvert: dependanceCoupee('api'),
    manche_disponible: manche !== null,
    duree_ms: Date.now() - debut,
  });
}

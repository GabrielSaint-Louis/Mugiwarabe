import { NextResponse } from 'next/server';
import { appeler } from '../disjoncteur';
import { mesure } from '../mesure';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';

// La sonde du front.
//
// Elle interroge l'API, mais elle ne tombe PAS avec elle, et c'est toute la
// nuance de la journee. Le front sait rendre sa page sans l'API : son etat
// reste donc 200. Ce qu'il declare, c'est que sa dependance est absente, ce qui
// permet de lire au tableau de bord la difference entre "le front est mort" et
// "le front va bien, l'API non".
//
// La sonde passe par le disjoncteur comme le reste : sans ca, elle serait le
// seul chemin qui continue de marteler une API deja tombee.
export async function GET() {
  const api = (await appeler('api', `${API}/sante`)) !== null;
  mesure.dependance.set({ dependance: 'api' }, api ? 1 : 0);

  return NextResponse.json({
    service: process.env.SERVICE || 'front',
    version: process.env.VERSION || 'dev',
    etat: 'ok',
    degrade: !api,
    dependances: { api },
  });
}

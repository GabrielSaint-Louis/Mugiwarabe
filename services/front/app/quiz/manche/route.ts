import { NextResponse } from 'next/server';
import { appeler } from '../../disjoncteur';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';
const CLASSEMENT = process.env.CLASSEMENT_URL || 'http://classement:3000';

// Le relai entre le navigateur et le reseau interne.
//
// Le telephone d'un eleve ne peut pas atteindre http://api:3000, et publier un
// port pour l'API lui donnerait une porte sur l'exterieur dont elle n'a aucun
// besoin.
//
// Les deux appels sont independants, et chacun a son propre disjoncteur : si le
// classement tombe, la question s'affiche quand meme. Un Promise.all qui
// rejette ferait disparaitre de l'ecran une donnee parfaitement disponible.
type Classement = { classement: unknown[]; a_jour: boolean };

export async function GET() {
  const [manche, classement] = await Promise.all([
    appeler<unknown>('api', `${API}/manche`),
    appeler<Classement>('classement', `${CLASSEMENT}/classement`),
  ]);

  return NextResponse.json({
    manche,
    classement: classement?.classement ?? [],
    classement_a_jour: classement?.a_jour ?? null,
  });
}

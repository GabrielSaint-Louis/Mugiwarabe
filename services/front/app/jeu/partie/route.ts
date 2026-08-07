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

// Commencer une partie.
export async function POST() {
  const partie = await appeler('api', `${API}/partie`, { method: 'POST' });
  if (!partie) return NextResponse.json({ raison: 'API injoignable' }, { status: 503 });
  return NextResponse.json(partie, { status: 201 });
}

// L'etat d'une partie, plus le classement. Les deux appels sont independants et
// chacun a son disjoncteur : si le classement tombe, la question s'affiche quand
// meme. Un Promise.all qui rejette ferait disparaitre de l'ecran une donnee
// parfaitement disponible.
export async function GET(requete: Request) {
  const jeton = new URL(requete.url).searchParams.get('jeton');

  const [partie, classement] = await Promise.all([
    jeton ? appeler('api', `${API}/partie/${jeton}`) : Promise.resolve(null),
    appeler<{ classement: unknown[]; a_jour: boolean }>('classement', `${CLASSEMENT}/classement`),
  ]);

  return NextResponse.json({
    partie,
    classement: classement?.classement ?? [],
    classement_a_jour: classement?.a_jour ?? null,
  });
}

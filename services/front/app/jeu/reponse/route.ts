import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';

export async function POST(requete: Request) {
  const { jeton, choix } = await requete.json();
  try {
    // Pas de disjoncteur ici, et le delai est long : quand la banque est
    // epuisee, l'API va demander une question neuve a la vigie, qui interroge un
    // modele externe. Cet appel-la peut prendre plusieurs secondes, et couper
    // au bout de deux ferait perdre une serie a un joueur qui n'a rien fait de
    // mal.
    const reponse = await fetch(`${API}/partie/${jeton}/reponse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choix }),
      signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(await reponse.json(), { status: reponse.status });
  } catch {
    return NextResponse.json({ erreur: 'API injoignable' }, { status: 503 });
  }
}

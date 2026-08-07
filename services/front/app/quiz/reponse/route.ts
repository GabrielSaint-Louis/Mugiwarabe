import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';

export async function POST(requete: Request) {
  const corps = await requete.json();
  try {
    const reponse = await fetch(`${API}/reponse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(2000),
    });
    return NextResponse.json(await reponse.json(), { status: reponse.status });
  } catch {
    // 503 ici est correct : la reponse du joueur n'a pas ete enregistree, il
    // faut le lui dire. C'est different de /travail, ou le front a bien fait
    // son travail meme sans l'API.
    return NextResponse.json({ accepte: false, raison: 'API injoignable' }, { status: 503 });
  }
}

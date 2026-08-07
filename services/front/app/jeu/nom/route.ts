import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL || 'http://api:3000';

export async function POST(requete: Request) {
  const { jeton, joueur } = await requete.json();
  try {
    const reponse = await fetch(`${API}/partie/${jeton}/nom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joueur }),
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json(await reponse.json(), { status: reponse.status });
  } catch {
    return NextResponse.json({ ok: false, raison: 'API injoignable' }, { status: 503 });
  }
}

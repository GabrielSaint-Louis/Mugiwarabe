import { mesure } from '../mesure';

export const dynamic = 'force-dynamic';

// Le front n'a pas de middleware Express ou brancher la mesure : Next sert ses
// pages lui-meme. On expose donc le registre partage du process, alimente par
// /sante pour l'etat de la dependance et par /travail pour les coups.
export async function GET() {
  return new Response(await mesure.register.metrics(), {
    headers: { 'Content-Type': mesure.register.contentType },
  });
}

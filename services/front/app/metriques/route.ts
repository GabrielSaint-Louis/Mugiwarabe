import { creerMesure } from '../../../../partage/mesure.js';

export const dynamic = 'force-dynamic';

// Le front n'a pas de middleware Express ou brancher la mesure : Next sert ses
// pages lui-meme. On expose donc le registre et les metriques par defaut du
// process, ce qui suffit a repondre aux deux questions qui comptent pour lui :
// est-ce qu'il tient la charge, et est-ce que sa dependance repond.
const mesure = creerMesure(process.env.SERVICE || 'front');

export async function GET() {
  return new Response(await mesure.register.metrics(), {
    headers: { 'Content-Type': mesure.register.contentType },
  });
}

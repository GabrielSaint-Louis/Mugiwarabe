// Ce que la vigie va chercher dehors.
//
// C'est le seul service de la flotte qui depend de quelqu'un d'autre que nous.
// Toute cette page est ecrite autour d'une seule idee : ce tiers a le droit
// d'etre lent, de tomber ou de repondre n'importe quoi, et rien de tout ca ne
// doit eteindre notre carre.

const MODELE = process.env.GROQ_MODELE || 'llama-3.3-70b-versatile';
const CLE = process.env.GROQ_API_KEY || '';

export const cleFournie = () => Boolean(CLE);

const CONSIGNE = `Tu ecris des questions de quiz sur Docker, les conteneurs, le
deploiement et la surveillance, pour des etudiants qui decouvrent le DevOps.
Reponds uniquement par un tableau JSON de 3 objets, sans texte autour.
Chaque objet : {"texte": "...", "propositions": ["...","...","...","..."], "bonne": 0}
"bonne" est l'index de la bonne reponse dans "propositions", entre 0 et 3.
Les questions doivent etre courtes, en francais, sans accents.`;

export async function demanderDesQuestions() {
  if (!CLE) throw new Error('aucune cle fournie');

  // Un delai d'attente explicite. Sans lui, un modele qui met une minute a
  // repondre garderait la boucle de generation bloquee tout ce temps, et la
  // sonde du service commencerait a mentir sur ce qu'il est en train de faire.
  const abandon = AbortSignal.timeout(20000);

  const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: abandon,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CLE}`,
    },
    body: JSON.stringify({
      model: MODELE,
      temperature: 0.9,
      messages: [
        { role: 'system', content: CONSIGNE },
        { role: 'user', content: 'Donne trois nouvelles questions.' },
      ],
    }),
  });

  if (!reponse.ok) {
    throw new Error(`le modele a repondu ${reponse.status}`);
  }

  const corps = await reponse.json();
  const texte = corps.choices?.[0]?.message?.content ?? '';

  // Le modele encadre volontiers son JSON de texte ou de balises de code, meme
  // quand on lui demande de ne pas le faire. On decoupe entre le premier
  // crochet et le dernier plutot que de faire confiance au format.
  const debut = texte.indexOf('[');
  const fin = texte.lastIndexOf(']');
  if (debut === -1 || fin === -1) throw new Error('reponse illisible du modele');

  return JSON.parse(texte.slice(debut, fin + 1));
}

// La validation. Elle existe parce qu'un modele externe n'est pas une source de
// verite : il renvoie parfois quatre propositions identiques, un index de bonne
// reponse hors des clous, ou une question vide. Rien de tout ca ne doit arriver
// jusqu'a la classe.
export function questionValable(brute) {
  if (!brute || typeof brute.texte !== 'string') return false;
  if (brute.texte.trim().length < 12 || brute.texte.length > 200) return false;
  if (!Array.isArray(brute.propositions) || brute.propositions.length !== 4) return false;
  if (brute.propositions.some((p) => typeof p !== 'string' || !p.trim())) return false;
  // Quatre propositions dont deux identiques rendraient la question insoluble.
  if (new Set(brute.propositions.map((p) => p.trim().toLowerCase())).size !== 4) return false;
  if (!Number.isInteger(brute.bonne) || brute.bonne < 0 || brute.bonne > 3) return false;
  return true;
}

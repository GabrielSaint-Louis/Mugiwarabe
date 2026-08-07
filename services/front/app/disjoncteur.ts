// Le disjoncteur, trouve en mesurant plutot qu'en reflechissant.
//
// Premiere version : chaque appel au reseau interne attendait son delai de deux
// secondes avant d'abandonner. API debout, /travail repondait en 7 ms. API
// morte, en 2001 ms.
//
// Ce chiffre est le probleme. Les coups partent par paquets de dix, donc trois
// cents coups font trente paquets, donc soixante secondes. Le pouls suivant
// serait bloque tout ce temps, le retard s'accumulerait, et le carre du FRONT
// palirait au tableau pour une panne qui est dans l'API. Le sujet demande
// exactement l'inverse : le front doit rester plein, parce que lui, il repond.
//
// Le disjoncteur regle ca. Quand une dependance a echoue, on arrete de
// l'appeler pendant trois secondes et on repond tout de suite en degrade. On
// ressaie ensuite : une seule requete paie le delai, pas les trois cents.
//
// C'est aussi ce qui evite d'achever un service deja en difficulte. Une
// dependance lente qui recoit trois cents appels de plus par pouls ne se remet
// jamais.

type Etat = { ouvertJusqua: number };

const etats = new Map<string, Etat>();
const REPOS_MS = 3000;

export function dependanceCoupee(cle: string): boolean {
  const etat = etats.get(cle);
  return Boolean(etat && Date.now() < etat.ouvertJusqua);
}

export async function appeler<T>(cle: string, url: string, options: RequestInit = {}): Promise<T | null> {
  // Le disjoncteur est ouvert : on ne touche meme pas au reseau. C'est ce qui
  // fait passer la reponse degradee de 2001 ms a moins d'une milliseconde.
  if (dependanceCoupee(cle)) return null;

  try {
    const reponse = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    if (!reponse.ok) throw new Error(String(reponse.status));
    etats.delete(cle);
    return (await reponse.json()) as T;
  } catch {
    etats.set(cle, { ouvertJusqua: Date.now() + REPOS_MS });
    return null;
  }
}

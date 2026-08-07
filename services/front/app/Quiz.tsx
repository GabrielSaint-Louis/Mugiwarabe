'use client';

import { useCallback, useEffect, useState } from 'react';

type Manche = {
  id: number;
  texte: string;
  propositions: string[];
};

type Ligne = { rang: number; joueur: string; points: number; reponses: number };

// Le front n'appelle pas l'API directement depuis le navigateur : il passe par
// ses propres routes, qui parlent a l'API sur le reseau interne. Le telephone
// d'un eleve n'a aucun moyen d'atteindre http://api:3000, et exposer l'API vers
// l'exterieur pour ca lui ferait un port publie dont elle n'a pas besoin.
const RELAI = '/quiz';

export default function Quiz() {
  const [manche, setManche] = useState<Manche | null>(null);
  const [classement, setClassement] = useState<Ligne[]>([]);
  const [classementDate, setClassementDate] = useState(false);
  const [apiAbsente, setApiAbsente] = useState(false);
  const [repondu, setRepondu] = useState<boolean | null>(null);
  const [joueur, setJoueur] = useState('');

  // Le pseudo vit dans le navigateur de chacun. Rien de tout ca ne remonte au
  // serveur autrement que dans une reponse, donc rien a persister cote flotte.
  useEffect(() => {
    const garde = window.localStorage.getItem('joueur');
    if (garde) return setJoueur(garde);
    const tire = `mousse-${Math.floor(Math.random() * 9000 + 1000)}`;
    window.localStorage.setItem('joueur', tire);
    setJoueur(tire);
  }, []);

  const rafraichir = useCallback(async () => {
    try {
      const reponse = await fetch(`${RELAI}/manche`, { cache: 'no-store' });
      if (!reponse.ok) throw new Error('indisponible');
      const donnees = await reponse.json();
      setManche(donnees.manche ?? null);
      setClassement(donnees.classement ?? []);
      setClassementDate(donnees.classement_a_jour === false);
      setApiAbsente(false);
    } catch {
      // On ne vide pas ce qui est deja affiche. Une coupure de deux secondes ne
      // doit pas faire disparaitre la question sous les yeux du joueur : on
      // signale que c'est fige, et on garde l'ecran.
      setApiAbsente(true);
    }
  }, []);

  useEffect(() => {
    rafraichir();
    const minuterie = setInterval(rafraichir, 4000);
    return () => clearInterval(minuterie);
  }, [rafraichir]);

  async function repondre(choix: number) {
    if (!manche) return;
    try {
      const reponse = await fetch(`${RELAI}/reponse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manche_id: manche.id, joueur, choix }),
      });
      const resultat = await reponse.json();
      setRepondu(resultat.juste ?? null);
    } catch {
      setApiAbsente(true);
    }
  }

  return (
    <section className="quiz">
      {apiAbsente && (
        <p className="avertissement">
          Donnees indisponibles : l&apos;API ne repond pas. La page, elle, va tres bien.
        </p>
      )}

      <div className="carte">
        <h2>La manche</h2>
        {manche ? (
          <>
            <p className="question">{manche.texte}</p>
            <ul className="propositions">
              {manche.propositions.map((proposition, index) => (
                <li key={index}>
                  <button onClick={() => repondre(index)} disabled={repondu !== null}>
                    {proposition}
                  </button>
                </li>
              ))}
            </ul>
            {repondu !== null && (
              <p className={repondu ? 'juste' : 'faux'}>
                {repondu ? 'Bonne reponse' : 'Rate, la prochaine sera la bonne'}
              </p>
            )}
          </>
        ) : (
          <p className="vide">
            {apiAbsente ? 'Aucune question a afficher pour le moment.' : 'Chargement de la manche...'}
          </p>
        )}
        <p className="discret">Vous jouez sous le nom de {joueur || '...'}</p>
      </div>

      <div className="carte">
        <h2>
          Le classement {classementDate && <span className="fige">fige</span>}
        </h2>
        {classement.length > 0 ? (
          <ol className="classement">
            {classement.map((ligne) => (
              <li key={ligne.joueur}>
                <span>{ligne.joueur}</span>
                <span className="points">{ligne.points}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="vide">Personne n&apos;a encore marque.</p>
        )}
      </div>
    </section>
  );
}

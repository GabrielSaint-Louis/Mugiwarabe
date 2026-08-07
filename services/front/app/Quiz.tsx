'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Question = { id: number; texte: string; propositions: string[]; origine: string };
type Ligne = { rang: number; joueur: string; serie: number; exploit: boolean };

type Etat =
  | { phase: 'accueil' }
  | { phase: 'question'; question: Question; serie: number; reste: number; fabriquee: boolean }
  | { phase: 'attente'; serie: number }
  | { phase: 'fini'; serie: number; fin: string; inscrit: boolean };

const RELAI = '/jeu';

export default function Quiz() {
  const [etat, setEtat] = useState<Etat>({ phase: 'accueil' });
  const [classement, setClassement] = useState<Ligne[]>([]);
  const [classementDate, setClassementDate] = useState(false);
  const [apiAbsente, setApiAbsente] = useState(false);
  const [nom, setNom] = useState('');
  const jeton = useRef<string | null>(null);

  const chargerClassement = useCallback(async () => {
    try {
      const r = await fetch(`${RELAI}/partie`, { cache: 'no-store' });
      const d = await r.json();
      setClassement(d.classement ?? []);
      setClassementDate(d.classement_a_jour === false);
      setApiAbsente(false);
    } catch {
      setApiAbsente(true);
    }
  }, []);

  useEffect(() => {
    chargerClassement();
    const t = setInterval(chargerClassement, 5000);
    return () => clearInterval(t);
  }, [chargerClassement]);

  // Le compte a rebours descend localement, mais il ne decide de rien : c'est le
  // serveur qui tranche, a partir de l'heure ou il a servi la question. Celui-ci
  // n'est qu'un affichage, et il est volontairement un peu pessimiste.
  useEffect(() => {
    if (etat.phase !== 'question') return;
    const t = setInterval(() => {
      setEtat((e) => (e.phase === 'question' ? { ...e, reste: Math.max(0, e.reste - 1) } : e));
    }, 1000);
    return () => clearInterval(t);
  }, [etat.phase]);

  async function commencer() {
    setEtat({ phase: 'attente', serie: 0 });
    try {
      const r = await fetch(`${RELAI}/partie`, { method: 'POST' });
      if (!r.ok) throw new Error();
      const d = await r.json();
      jeton.current = d.jeton;
      setEtat({ phase: 'question', question: d.question, serie: 0, reste: d.secondes, fabriquee: false });
      setApiAbsente(false);
    } catch {
      setApiAbsente(true);
      setEtat({ phase: 'accueil' });
    }
  }

  async function repondre(choix: number) {
    if (etat.phase !== 'question') return;
    const serie = etat.serie;
    // On passe en attente tout de suite : quand la banque est epuisee, l'API va
    // demander une question neuve a la vigie, qui interroge un modele externe.
    // Sans cet ecran, le joueur croirait que le bouton n'a pas marche.
    setEtat({ phase: 'attente', serie });
    try {
      const r = await fetch(`${RELAI}/reponse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeton: jeton.current, choix }),
      });
      const d = await r.json();

      if (d.fini) {
        setEtat({ phase: 'fini', serie: d.serie ?? serie, fin: d.fin ?? 'mauvaise reponse', inscrit: false });
        chargerClassement();
      } else {
        setEtat({
          phase: 'question',
          question: d.question,
          serie: d.serie,
          reste: 15,
          fabriquee: (d.fabriquees ?? 0) > 0,
        });
      }
      setApiAbsente(false);
    } catch {
      setApiAbsente(true);
      setEtat({ phase: 'fini', serie, fin: 'API injoignable', inscrit: false });
    }
  }

  async function inscrire() {
    if (etat.phase !== 'fini' || nom.trim().length < 2) return;
    try {
      const r = await fetch(`${RELAI}/nom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeton: jeton.current, joueur: nom.trim() }),
      });
      if (r.ok) {
        setEtat({ ...etat, inscrit: true });
        setNom('');
        chargerClassement();
      }
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
        {etat.phase === 'accueil' && (
          <>
            <h2>La regle</h2>
            <p className="question">Repondez juste. Une seule erreur et c&apos;est fini.</p>
            <p className="discret">
              Quinze secondes par question. Quand vous aurez repondu a toutes celles
              qui existent, la vigie en fabriquera de nouvelles pour vous.
            </p>
            <button className="gros" onClick={commencer}>Commencer</button>
          </>
        )}

        {etat.phase === 'attente' && (
          <>
            <h2>Serie de {etat.serie}</h2>
            <p className="vide">On cherche la question suivante...</p>
            <p className="discret">
              Si vous avez epuise la banque, la vigie est en train d&apos;en fabriquer une.
            </p>
          </>
        )}

        {etat.phase === 'question' && (
          <>
            <h2>
              Serie de {etat.serie}
              <span className={etat.reste <= 5 ? 'chrono urgent' : 'chrono'}>{etat.reste}s</span>
            </h2>
            {etat.fabriquee && (
              <p className="fraiche">Question fabriquee a l&apos;instant pour vous</p>
            )}
            <p className="question">{etat.question.texte}</p>
            <ul className="propositions">
              {etat.question.propositions.map((proposition, index) => (
                <li key={index}>
                  <button onClick={() => repondre(index)}>{proposition}</button>
                </li>
              ))}
            </ul>
            {etat.question.origine === 'vigie' && (
              <p className="discret">Cette question vient de la vigie.</p>
            )}
          </>
        )}

        {etat.phase === 'fini' && (
          <>
            <h2>{etat.fin === 'banque epuisee' ? 'Vous avez tout eu' : 'Termine'}</h2>
            <p className="question">
              Serie de <strong>{etat.serie}</strong>
              {etat.fin === 'banque epuisee' && ' — et il n’y avait plus rien a vous proposer'}
            </p>
            <p className="discret">
              {etat.fin === 'mauvaise reponse' && 'Mauvaise reponse.'}
              {etat.fin === 'temps ecoule' && 'Le temps est ecoule.'}
              {etat.fin === 'banque epuisee' && 'La vigie n’a pas pu fabriquer de question neuve.'}
              {etat.fin === 'API injoignable' && 'L’API n’a pas repondu.'}
            </p>

            {etat.inscrit ? (
              <p className="juste">Inscrit au classement.</p>
            ) : etat.serie > 0 ? (
              <div className="inscription">
                <label htmlFor="nom">Votre nom, pour le classement</label>
                <div className="ligne">
                  <input
                    id="nom"
                    value={nom}
                    maxLength={24}
                    onChange={(e) => setNom(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && inscrire()}
                    placeholder="deux caracteres au minimum"
                  />
                  <button onClick={inscrire} disabled={nom.trim().length < 2}>Inscrire</button>
                </div>
              </div>
            ) : (
              <p className="discret">Serie de zero : rien a inscrire.</p>
            )}

            <button className="gros" onClick={commencer}>Rejouer</button>
          </>
        )}
      </div>

      <div className="carte">
        <h2>Les plus longues series {classementDate && <span className="fige">fige</span>}</h2>
        {classement.length > 0 ? (
          <ol className="classement">
            {classement.map((ligne) => (
              <li key={ligne.joueur}>
                <span>
                  {ligne.joueur} {ligne.exploit && <span title="a epuise la banque">★</span>}
                </span>
                <span className="points">{ligne.serie}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="vide">Personne n&apos;a encore inscrit de serie.</p>
        )}
        <p className="discret">
          Le nom n&apos;est demande qu&apos;a la fin, quand il y a quelque chose a inscrire.
        </p>
      </div>
    </section>
  );
}

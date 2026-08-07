import Quiz from './Quiz';

// Cette page est rendue une seule fois, a la construction de l'image, et elle
// n'appelle jamais l'API. C'est le choix qui decide de tout aujourd'hui.
//
// Ecrite naturellement, une page Next va chercher ses donnees au rendu : l'API
// meurt, l'appel echoue, une exception remonte, et la page ne s'affiche pas. Le
// tableau afficherait alors deux carres eteints pour une seule panne, et
// raconterait a la classe une histoire plus grave que la realite.
//
// Ici, la coquille est statique. Le titre, le pavillon, le chapeau de paille et
// la mise en page s'affichent quoi qu'il arrive. Seule la zone du quiz depend
// de l'API, et elle se remplit cote client, apres coup, avec un message honnete
// quand les donnees ne viennent pas.
export default function Page() {
  return (
    <main>
      <header className="pont">
        <img src="https://lespagesafrocarib.com/mugiwarabe/luffy.png" alt="" className="luffy" />
        <div>
          <p className="equipage">Equipage Mugiwarabe</p>
          <h1>Grand Line</h1>
          <p className="pavillon">Je serai le Roi des DevOps</p>
        </div>
      </header>

      <Quiz />

      <footer>
        <p>
          Quatre carres au tableau : <code>front</code>, <code>api</code>,{' '}
          <code>classement</code>, <code>vigie</code>.
        </p>
        <p className="discret">
          Cette page s&apos;affiche meme quand l&apos;API est tombee. C&apos;est fait expres.
        </p>
      </footer>
    </main>
  );
}

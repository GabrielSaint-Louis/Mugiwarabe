// Le point d'entree que Next appelle une fois, au demarrage du serveur, avant
// de servir la moindre requete. C'est le seul endroit ou brancher le pouls dans
// une application Next : le mettre dans un composant le ferait partir a chaque
// rendu, et le mettre dans une route le ferait attendre la premiere visite.
export async function register() {
  // Le garde-fou : Next execute aussi ce fichier dans le runtime Edge, ou
  // node:fs et node:os n'existent pas. Sans ce test, le build casse.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { demarrerLePouls } = await import('../../partage/pouls.js');
  demarrerLePouls();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output standalone : Next fabrique un dossier qui contient le serveur et les
  // seules dependances dont il a besoin. C'est ce qui permet de ne pas embarquer
  // les 400 Mo de node_modules dans l'image finale.
  output: 'standalone',

  // La racine du monorepo, et pas le dossier du front. Sans ca, le fichier
  // partage/pouls.js reste dehors du build standalone : le conteneur demarre,
  // sert la page, et n'envoie jamais de pouls. Le carre du front resterait
  // eteint pendant que la page s'affiche parfaitement dans un navigateur.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // Le front ne rend jamais rien qui vienne de l'API au moment du rendu. La
  // page est entierement statique, et les donnees arrivent ensuite cote client.
  // C'est ce qui garde le carre du front plein quand l'API meurt.
  reactStrictMode: true,
};

export default nextConfig;

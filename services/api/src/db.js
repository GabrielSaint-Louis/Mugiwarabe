import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

const dossier = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  // Trois exemplaires de l'API derriere le meme nom, c'est trois pools de
  // connexions vers la meme base. Postgres en accepte 100 par defaut : dix par
  // exemplaire laisse de la marge pour le reste de la flotte.
  max: 10,
  // Sans ce delai, une base injoignable fait attendre la requete indefiniment,
  // et la route de sante repond lentement au lieu de repondre faux. Un service
  // qui met trente secondes a dire qu'il va mal est un service muet.
  connectionTimeoutMillis: 3000,
});

let baseVivante = false;

// Le piege le plus cher de la journee, trouve en coupant la base a la main.
//
// Quand Postgres s'arrete, il coupe les connexions que le pool gardait au repos.
// node-postgres remonte alors une erreur sur l'objet Pool lui-meme, et non sur
// une requete : personne ne l'attend, Node la traite comme une exception non
// capturee, et le process meurt.
//
// Le resultat au tableau serait le pire des deux mondes : le carre de l'API
// s'eteint alors qu'elle etait parfaitement capable de continuer a servir le
// front. Une seule panne en aurait affiche deux, et le diagnostic aurait
// cherche du cote de l'API au lieu de la base.
//
// Ecouter l'evenement suffit. On ne repare rien ici, on refuse juste de mourir.
pool.on('error', (erreur) => {
  console.error('[db] connexion au repos perdue :', erreur.message);
  baseVivante = false;
});

// Etat de la derniere interrogation reussie. C'est ce que la route de sante et
// la metrique de dependance lisent, plutot que d'ouvrir une connexion a chaque
// appel : sous les salves, la sonde deviendrait elle-meme une source de charge.
export const etatBase = () => baseVivante;

export async function interrogerLaBase() {
  try {
    await pool.query('SELECT 1');
    baseVivante = true;
  } catch (erreur) {
    if (baseVivante) console.error('[db] la base ne repond plus :', erreur.message);
    baseVivante = false;
  }
  return baseVivante;
}

export async function initialiserSchema() {
  const sql = fs.readFileSync(path.join(dossier, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema applique');
}

// L'API demarre avant sa base : docker compose lance les conteneurs ensemble et
// Postgres met quelques secondes a accepter des connexions. Abandonner au
// premier echec ferait boucler le conteneur en redemarrage pendant que la base
// finit tranquillement de demarrer.
export async function attendreLaBase(essais = 30) {
  for (let i = 1; i <= essais; i++) {
    if (await interrogerLaBase()) return true;
    console.warn(`[db] base injoignable, tentative ${i}/${essais}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function surveillerLaBase(intervalleMs = 5000) {
  const minuterie = setInterval(interrogerLaBase, intervalleMs);
  // unref : cette minuterie ne doit pas empecher le process de sortir quand on
  // lui demande de s'arreter. Sans ca, docker stop attendrait le SIGKILL.
  minuterie.unref();
  return minuterie;
}

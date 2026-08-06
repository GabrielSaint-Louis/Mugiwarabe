'use strict';

// ---------------------------------------------------------------------------
//  Instrumentation de la Todo API (jour 3, phase 7)
//
//  Une application qui ne dit rien d'elle-meme est une boite noire. On sait
//  qu'elle tourne parce que le conteneur est "Up", et c'est tout : ni combien
//  de requetes elle sert, ni lesquelles echouent, ni en combien de temps elle
//  repond. Ce fichier lui donne la parole, et Prometheus vient l'ecouter.
// ---------------------------------------------------------------------------
const client = require('prom-client');
const { pool, etatBase } = require('./db');

// Un Registry rassemble toutes les metriques de l'application. On en cree un
// explicitement plutot que d'utiliser le registre global : deux tests qui
// s'executent dans le meme process ne se marchent pas dessus, et on sait
// exactement ce qui est expose.
const register = new client.Registry();

// Metriques standard offertes par la librairie : memoire, CPU, event loop,
// descripteurs de fichiers. Rien a coder, et c'est ce qu'on regarde en premier
// quand une application ralentit sans que le trafic ait bouge.
client.collectDefaultMetrics({ register, prefix: 'todo_api_' });

// --- Les deux metriques HTTP -----------------------------------------------

// Counter : ne fait que monter. C'est le type correct pour compter des
// requetes — un gauge qu'on incremente sans jamais le decrementer y
// ressemble, mais rate() et increase() donneraient des resultats faux des
// qu'un redemarrage remet le compteur a zero.
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requetes HTTP servies',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  // Les tranches sont en secondes, et elles doivent coller au profil REEL de
  // l'API. Celle-ci repond en quelques millisecondes : avec les tranches d'un
  // exemple generique (0.05 en premiere valeur), tout tomberait dans le
  // premier seau et le p95 repondrait "moins de 50 ms" sans jamais rien
  // distinguer. On descend donc a 5 ms.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

// --- La metrique metier, celle que personne d'autre ne peut deviner ---------
//
// C'est elle qui fait la difference entre un tableau de bord generique et un
// tableau de bord utile. Les deux angles sont complementaires : le compteur dit
// ce que l'application a fait depuis son demarrage, la jauge dit ou en est le
// systeme maintenant. Un redeploiement remet le premier a zero, jamais la
// seconde.
const tasksCreatedTotal = new client.Counter({
  name: 'todo_tasks_created_total',
  help: 'Nombre de taches creees depuis le demarrage de ce process',
  registers: [register],
});

// --- La metrique qui manquait au jour 3 ------------------------------------
//
// Jusqu'ici, rien ne distinguait « l'API va bien » de « l'API va bien ET la
// base repond ». C'est la limite mesuree en phase 7 du jour 4 : base coupee,
// les trois pods restent READY 1/1 et aucune alerte ne parle.
//
// Cette jauge dit la difference, sans rien coûter : elle relit l'etat mis en
// cache par la surveillance de src/db.js, elle n'interroge jamais Postgres.
const dbUp = new client.Gauge({
  name: 'todo_db_up',
  help: 'La base repond-elle a cette copie de l API (1) ou non (0)',
  registers: [register],
});

const tasksInDatabase = new client.Gauge({
  name: 'todo_tasks_in_database',
  help: 'Nombre de taches actuellement en base, par etat',
  labelNames: ['status'],
  registers: [register],
});

// La jauge se rafraichit au moment du scrape, pas en continu : interroger la
// base toutes les secondes pour une valeur que personne ne lit serait du
// gaspillage.
async function rafraichirJauge() {
  // Lecture du cache, pas une requete de plus : la surveillance de src/db.js
  // interroge la base toutes les 10 s, quel que soit le nombre de scrapes.
  dbUp.set(etatBase.joignable ? 1 : 0);

  try {
    const { rows } = await pool.query('SELECT status, count(*)::int AS n FROM tasks GROUP BY status');

    // Remise a zero des etats absents du resultat : sans ca, un etat qui passe
    // de 3 taches a 0 garderait eternellement sa derniere valeur connue.
    for (const status of ['todo', 'in_progress', 'done']) {
      tasksInDatabase.set({ status }, 0);
    }
    for (const row of rows) {
      tasksInDatabase.set({ status: row.status }, row.n);
    }
  } catch (err) {
    // DETAIL QUI COMPTE PENDANT L'ASTREINTE.
    //
    // Si la base tombe et que cette erreur remonte, /metrics repond 500,
    // Prometheus n'obtient plus rien, et `up` passe a 0 — exactement la meme
    // signature que si l'API entiere etait morte. Les deux pannes seraient
    // indiscernables sur le tableau de bord.
    //
    // En avalant l'erreur ici, la signature reste distincte : la cible repond
    // toujours (up = 1), mais les 503 explosent. C'est ce qui permet de dire
    // "c'est la base" plutot que "c'est l'API" en un coup d'oeil.
    console.warn('[metrics] jauge des taches non rafraichie :', err.message);
  }
}

// --- Le middleware ---------------------------------------------------------

function middleware(req, res, next) {
  const stopTimer = httpRequestDuration.startTimer();

  // 'finish' et pas la fin du handler : on mesure jusqu'au depart reel de la
  // reponse, ce que vit le client.
  res.on('finish', () => {
    const labels = { method: req.method, route: nomDeRoute(req), status: res.statusCode };
    httpRequestsTotal.inc(labels);
    stopTimer(labels);
  });

  next();
}

// Le piege de la cardinalite, et il tombe a tous les coups.
//
// Si le label vaut l'URL reelle (/api/tasks/8f2c-...), chaque tache creee
// fabrique sa propre serie temporelle, et Prometheus s'etouffe au bout de
// quelques milliers. Le label doit valoir la route DECLAREE : /api/tasks/:id.
// L'identifiant de la tache reste ou il a toujours vecu, dans les logs.
function nomDeRoute(req) {
  if (req.route) {
    // req.route.path vaut '/:id' pour un routeur monte sur '/api/tasks' :
    // sans le baseUrl, toutes les routes du routeur se confondraient sous
    // le meme label '/'.
    const complete = (req.baseUrl || '') + req.route.path;

    // La racine d'un routeur donne '/api/tasks' + '/' = '/api/tasks/', avec
    // une barre finale que '/api/tasks/:id' n'a pas. Deux ecritures pour deux
    // routes voisines, c'est un tableau de bord ou l'on hesite a chaque
    // panneau. On normalise, sauf si la route EST la racine du site.
    return complete.length > 1 ? complete.replace(/\/$/, '') : complete;
  }

  // Aucune route ne correspond : c'est un 404. Il DOIT etre compte, sinon la
  // moitie des erreurs devient invisible — mais surtout pas sous son URL, qui
  // est choisie par l'appelant. Un scanner qui tape mille chemins differents
  // creerait mille series en quelques secondes.
  return '(inconnue)';
}

module.exports = {
  register,
  middleware,
  rafraichirJauge,
  tasksCreatedTotal,
};

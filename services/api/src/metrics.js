// Ce que l'API raconte d'elle-meme a Prometheus.
//
// Le tableau de la classe dit qu'un carre est eteint. Il ne dira jamais
// pourquoi. Ces metriques sont la moitie de la reponse, les quatre panneaux du
// palier 6 sont l'autre.
import client from 'prom-client';
import { config } from './config.js';

export const register = new client.Registry();

// Toutes les metriques de la flotte portent le nom du service qui les emet.
// Sans ce label, trois services qui exposent http_requests_total donnent une
// seule courbe additionnee, et on perd exactement ce qu'on cherchait a voir.
register.setDefaultLabels({ service: config.service });

client.collectDefaultMetrics({ register, prefix: 'flotte_' });

const requetesTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requetes HTTP servies',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// Un histogramme et pas une moyenne. La moyenne masque exactement ce qu'on
// cherche : quand un service sature, ce sont les requetes lentes qui se
// multiplient, et elles disparaissent dans une moyenne tiree vers le bas par
// toutes les rapides.
const dureeRequetes = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

export const coupsEncaisses = new client.Counter({
  name: 'coups_encaisses_total',
  help: 'Coups tires par la classe et absorbes par ce service',
  registers: [register],
});

export function mesurerRequetes(requete, reponse, suite) {
  const fin = dureeRequetes.startTimer();
  reponse.on('finish', () => {
    // requete.route est le motif de la route et non l'URL appelee. Utiliser
    // l'URL brute ferait exploser le nombre de series temporelles des qu'une
    // route prend un identifiant : Prometheus garderait une courbe par valeur.
    const route = requete.route ? requete.route.path : 'inconnue';
    const etiquettes = {
      method: requete.method,
      route,
      status: reponse.statusCode,
    };
    requetesTotal.inc(etiquettes);
    fin(etiquettes);
  });
  suite();
}

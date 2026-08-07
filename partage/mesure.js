// Ce que chaque service de la flotte raconte de lui-meme a Prometheus.
//
// Ce fichier est partage par les quatre. Trois copies d'un meme registre auraient
// dérivé dans la journee : un service aurait fini avec des tranches d'histogramme
// differentes des autres, et le panneau de latence de l'apres-midi aurait compare
// des choses non comparables.
//
// Le tableau de la classe dit qu'un carre est eteint. Il ne dira jamais pourquoi.
// Ces metriques sont la moitie de la reponse, les quatre panneaux sont l'autre.
import client from 'prom-client';

export function creerMesure(service) {
  const register = new client.Registry();

  // Toutes les metriques portent le nom du service qui les emet. Sans ce label,
  // quatre services qui exposent http_requests_total donnent une seule courbe
  // additionnee, et on perd exactement ce qu'on cherchait a voir.
  register.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register, prefix: 'flotte_' });

  const requetesTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Nombre total de requetes HTTP servies',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
  });

  // Un histogramme et pas une moyenne. Quand un service sature, ce sont les
  // requetes lentes qui se multiplient, et elles disparaissent dans une moyenne
  // tiree vers le bas par toutes les rapides. La moyenne masque exactement ce
  // qu'on cherche.
  const dureeRequetes = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duree des requetes HTTP en secondes',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  const coupsEncaisses = new client.Counter({
    name: 'coups_encaisses_total',
    help: 'Coups tires par la classe et absorbes par ce service',
    registers: [register],
  });

  // 0 ou 1, comme le sujet le demande. Un gauge et pas un compteur : ce qui
  // interesse, c'est l'etat maintenant, pas le nombre de fois ou la dependance
  // est tombee depuis le demarrage.
  const dependance = new client.Gauge({
    name: 'dependance_disponible',
    help: 'Etat de la dependance du service : 1 si elle repond, 0 sinon',
    labelNames: ['dependance'],
    registers: [register],
  });

  function mesurerRequetes(requete, reponse, suite) {
    const fin = dureeRequetes.startTimer();
    reponse.on('finish', () => {
      // requete.route est le motif de la route, pas l'URL appelee. Utiliser
      // l'URL brute ferait exploser le nombre de series des qu'une route prend
      // un identifiant : Prometheus garderait une courbe par valeur.
      const etiquettes = {
        method: requete.method,
        route: requete.route ? requete.route.path : 'inconnue',
        status: reponse.statusCode,
      };
      requetesTotal.inc(etiquettes);
      fin(etiquettes);
    });
    suite();
  }

  // Une route, pas un export : les quatre services l'exposent au meme endroit,
  // donc la configuration de Prometheus n'a qu'un seul chemin a connaitre.
  function brancherLaRoute(app) {
    app.get('/metriques', async (requete, reponse) => {
      reponse.set('Content-Type', register.contentType);
      reponse.end(await register.metrics());
    });
  }

  return { register, mesurerRequetes, brancherLaRoute, coupsEncaisses, dependance };
}

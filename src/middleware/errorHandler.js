'use strict';

// Gestionnaire d'erreurs central. Regle unique : le client recoit toujours du
// JSON exploitable, jamais un stacktrace brut. La trace complete part dans les
// logs du conteneur (stdout), la ou `docker logs` saura la retrouver.
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Corps JSON malforme : body-parser leve une SyntaxError avec ce type.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'corps de requete JSON invalide' });
  }

  // Corps trop volumineux pour la limite fixee sur express.json().
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'corps de requete trop volumineux' });
  }

  // Erreurs metier levees par le modele (validation des entrees).
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  // Tout le reste est un bug de notre cote : on loggue, on repond 500 sobre.
  console.error('[error]', err.stack || err);
  return res.status(500).json({ error: 'erreur interne du serveur' });
}

module.exports = errorHandler;

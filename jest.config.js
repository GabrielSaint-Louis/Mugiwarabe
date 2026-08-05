'use strict';

// Une seule configuration pour les deux suites. Ce qui les separe, c'est le
// chemin passe a Jest (`jest tests/unit` / `jest tests/integration`), pas deux
// fichiers de configuration qui divergeraient au premier changement.
module.exports = {
  testEnvironment: 'node',

  // src/config.js refuse de demarrer sans DB_HOST, DB_NAME, DB_USER et
  // DB_PASSWORD. C'est voulu (chapitre 7), donc les tests fournissent ces
  // variables avant que le moindre require() ne les lise.
  setupFiles: ['<rootDir>/tests/setup-env.js'],

  // Les tests unitaires ne touchent aucune base : s'ils trainent au-dela de
  // cinq secondes, c'est qu'ils attendent quelque chose qu'ils ne devraient
  // pas attendre. Les tests d'integration relevent ce delai eux-memes.
  testTimeout: 5000,
};

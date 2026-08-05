'use strict';

// ESLint 9, configuration plate (flat config) : un tableau d'objets, chacun
// disant a quels fichiers il s'applique. Meme format que celui de ClickFast,
// pour que la commande `npm run lint` veuille dire la meme chose des deux
// cotes.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // Rien de tout cela n'est du code source a nous : le linter n'a aucune
    // raison d'y passer, et une seule erreur dedans rendrait la CI rouge sans
    // qu'on puisse la corriger.
    ignores: ['node_modules/**', 'coverage/**', 'exercices/**'],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Un `console.log` oublie n'est pas une erreur en soi : les logs du
      // conteneur passent justement par la. On garde la regle desactivee.
      'no-console': 'off',
      // Le parametre `next` d'un middleware d'erreur Express est obligatoire
      // meme inutilise : sans lui, Express ne reconnait pas la signature a
      // quatre arguments. On tolere donc les arguments inutilises, mais pas
      // les variables.
      'no-unused-vars': ['error', { args: 'none' }],
      eqeqeq: ['error', 'always'],
    },
  },

  {
    // Les fichiers de test connaissent describe/test/expect, que le
    // environnement node seul ne declare pas.
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];

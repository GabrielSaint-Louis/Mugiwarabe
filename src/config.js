'use strict';

// Charge le .env dans process.env quand il existe. En conteneur, les variables
// arrivent deja par env_file/environment : dotenv ne fait alors rien, et c'est
// tres bien. Le meme code tourne en local et en conteneur sans condition.
require('dotenv').config();

// Une variable obligatoire absente doit faire echouer le demarrage tout de
// suite, avec un message qui nomme la variable. L'alternative, un `undefined`
// qui se propage, casse trois couches plus loin dans une erreur incomprehensible
// du driver Postgres.
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Variable d'environnement obligatoire manquante : ${name}. ` +
        'Copiez .env.example vers .env et renseignez-la.'
    );
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  // 0.0.0.0 et pas 127.0.0.1 : dans un conteneur, ecouter sur la loopback rend
  // l'app injoignable depuis l'exterieur, meme avec le bon -p.
  host: process.env.HOST || '0.0.0.0',

  db: {
    // Ces cinq cles sont exactement celles que lit stats_api/main.py
    // (chapitre 8). Deux services qui partagent une base lisent la meme
    // configuration : il serait absurde de l'appeler autrement de chaque cote.
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT) || 5432,
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
};

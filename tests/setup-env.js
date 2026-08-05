'use strict';

// Charge avant les tests. Deux cas :
//
//   - suite unitaire : ces valeurs ne servent qu'a satisfaire les verifications
//     de src/config.js. Aucune connexion n'est ouverte, la base designee ici
//     n'a pas besoin d'exister.
//   - suite d'integration : la pipeline (ou docker compose en local) a deja
//     positionne les vraies variables, et les `??=` ci-dessous ne font rien.
//
// `??=` et pas `=` : on ne surcharge jamais une variable deja fournie par
// l'environnement, sans quoi les tests d'integration parleraient a la mauvaise
// base.
process.env.NODE_ENV ??= 'test';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5432';
process.env.DB_NAME ??= 'todo_test';
process.env.DB_USER ??= 'todo_user';
process.env.DB_PASSWORD ??= 'todo_pass';

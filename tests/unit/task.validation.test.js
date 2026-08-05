'use strict';

// Tests unitaires du modele : uniquement les chemins qui n'atteignent jamais
// PostgreSQL. La validation rejette AVANT le pool.query(), et les gardes sur
// les identifiants renvoient avant lui aussi. Une base injoignable ici ferait
// donc echouer le test pour la mauvaise raison : si l'un d'eux se met a
// pendre, c'est qu'une validation a saute et que la requete est partie.
const Task = require('../../src/models/task');

describe('validation d une tache a la creation', () => {
  test('refuse une description absente', async () => {
    await expect(Task.create({ status: 'todo' })).rejects.toMatchObject({
      name: 'ValidationError',
      status: 400,
      message: 'description est obligatoire',
    });
  });

  test('refuse une description vide ou faite d espaces', async () => {
    await expect(Task.create({ description: '   ' })).rejects.toMatchObject({
      status: 400,
      message: 'description ne peut pas etre vide',
    });
  });

  test('refuse une description au-dela de la limite, et dit laquelle', async () => {
    const trop = 'a'.repeat(Task.MAX_DESCRIPTION_LENGTH + 1);

    await expect(Task.create({ description: trop })).rejects.toMatchObject({
      status: 400,
      // Le message doit nommer la limite ET la longueur recue : une erreur 400
      // qui dit juste "invalide" oblige l'appelant a deviner.
      message: `description est limitee a ${Task.MAX_DESCRIPTION_LENGTH} caracteres (recue : ${trop.length})`,
    });
  });

  // La borne elle-meme (exactement MAX_DESCRIPTION_LENGTH caracteres) doit
  // etre acceptee : c'est le +1 qui casse. Ce cas ne peut pas se verifier ici
  // sans ouvrir une connexion, puisqu'une entree valide continue jusqu'a la
  // base. Il est couvert par tests/integration/tasks.test.js, contre un vrai
  // PostgreSQL.

  test('refuse un status hors de la liste admise', async () => {
    await expect(Task.create({ description: 'ok', status: 'presque_fini' })).rejects.toMatchObject({
      status: 400,
      message: `status doit valoir l'un de : ${Task.STATUSES.join(', ')}`,
    });
  });

  test('refuse un corps qui n est pas un objet JSON', async () => {
    for (const corps of [null, 'une chaine', ['un', 'tableau'], 42]) {
      await expect(Task.create(corps)).rejects.toMatchObject({
        status: 400,
        message: 'le corps de la requete doit etre un objet JSON',
      });
    }
  });
});

describe('garde sur les identifiants', () => {
  // Un id qui n'est pas un UUID ferait exploser le cast cote Postgres en 500.
  // Le modele doit le traiter comme un simple "introuvable", sans requete.
  test('findById renvoie null sur un id qui n est pas un UUID', async () => {
    await expect(Task.findById('42')).resolves.toBeNull();
    await expect(Task.findById('../../etc/passwd')).resolves.toBeNull();
  });

  test('update renvoie null sur un id qui n est pas un UUID', async () => {
    await expect(Task.update('42', { description: 'peu importe' })).resolves.toBeNull();
  });

  test('remove renvoie false sur un id qui n est pas un UUID', async () => {
    await expect(Task.remove('42')).resolves.toBe(false);
  });
});

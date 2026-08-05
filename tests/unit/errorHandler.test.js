'use strict';

// Le gestionnaire d'erreurs central est une fonction pure au sens qui compte
// ici : une erreur entre, un statut et un corps JSON sortent. C'est le cas
// d'ecole du test unitaire, sans reseau ni base.
const errorHandler = require('../../src/middleware/errorHandler');

// Un faux `res` minimal : il enregistre ce qu'on lui demande au lieu d'ecrire
// sur une socket. C'est un mock legitime — on teste notre propre logique de
// correspondance, pas le comportement d'Express.
function fauxRes() {
  const res = { headersSent: false, statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

function traite(err) {
  const res = fauxRes();
  errorHandler(err, {}, res, () => {});
  return res;
}

describe('correspondance erreur -> code de statut', () => {
  test('un JSON malforme donne un 400, jamais un 500', () => {
    const res = traite(Object.assign(new SyntaxError('bad json'), { type: 'entity.parse.failed' }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'corps de requete JSON invalide' });
  });

  test('un corps trop volumineux donne un 413', () => {
    const res = traite(Object.assign(new Error('too large'), { type: 'entity.too.large' }));

    expect(res.statusCode).toBe(413);
  });

  test('une erreur metier remonte son propre statut et son message', () => {
    const res = traite(Object.assign(new Error('description est obligatoire'), { status: 400 }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'description est obligatoire' });
  });

  // C'est la distinction du chapitre 6, et celle qui compte pendant l'astreinte :
  // une base tombee n'est pas un bug applicatif. Un 503 dit "reessaie", un 500
  // enverrait chercher le bug dans le code pendant que le vrai probleme est a
  // cote.
  test.each([
    ['ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432'],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND todo-db'],
    ['ETIMEDOUT', 'connect ETIMEDOUT'],
    ['57P01', 'terminating connection due to administrator command'],
  ])('une base injoignable (%s) donne un 503', (code, message) => {
    const res = traite(Object.assign(new Error(message), { code }));

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'base de donnees injoignable, reessayez plus tard' });
  });

  test('un timeout de pool reconnu par son message donne aussi un 503', () => {
    const res = traite(new Error('timeout expired'));

    expect(res.statusCode).toBe(503);
  });

  test('tout le reste donne un 500 sobre, sans stacktrace pour le client', () => {
    const res = traite(new Error('undefined is not a function'));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'erreur interne du serveur' });
    expect(JSON.stringify(res.body)).not.toMatch(/at /); // aucune trace ne fuit
  });

  test('une reponse deja envoyee est passee au suivant, pas reecrite', () => {
    const res = fauxRes();
    res.headersSent = true;
    let passeAuSuivant = false;

    errorHandler(new Error('trop tard'), {}, res, () => {
      passeAuSuivant = true;
    });

    expect(passeAuSuivant).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});

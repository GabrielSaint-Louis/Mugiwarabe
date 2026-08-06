'use strict';

// Supertest envoie de vraies requetes HTTP a l'objet `app` Express, sans
// demarrer de serveur sur un port fixe et sans navigateur. On reste au niveau
// unitaire : seules les routes qui ne touchent pas la base sont testees ici,
// le reste est le travail de la suite d'integration.
const request = require('supertest');
const app = require('../../src/app');

describe('surface HTTP qui ne depend pas de la base', () => {
  test('GET /health repond 200 et un statut ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // Le timestamp doit etre une date lisible : c'est ce que lit la procedure
    // de deploiement pour dire "l'API repond depuis quand".
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test('une route inconnue repond 404 en JSON, jamais en HTML', async () => {
    const res = await request(app).get('/pas-une-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'route introuvable' });
  });

  test('un corps JSON malforme repond 400, pas 500', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"description": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'corps de requete JSON invalide' });
  });

  test('helmet pose bien ses en-tetes de securite', async () => {
    const res = await request(app).get('/health');

    // Deux en-tetes qui n'existent pas sur un Express nu : leur presence prouve
    // que le middleware est branche, leur absence qu'un `app.use(helmet())` a
    // saute pendant un refactor.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
//  /ready, la distinction ajoutee au jour 4
//
//  Ces deux cas tiennent dans la suite UNITAIRE, alors qu'ils parlent de la
//  base, et c'est tout l'interet de la conception retenue : /ready lit un etat
//  mis en cache, il n'interroge pas Postgres. On peut donc simuler une base
//  morte sans base du tout, en ecrivant dans ce cache.
// ---------------------------------------------------------------------------
describe('/ready dit ce que /health ne dit pas', () => {
  const { etatBase } = require('../../src/db');
  const etatInitial = { ...etatBase };

  afterEach(() => {
    Object.assign(etatBase, etatInitial);
  });

  test('base joignable : 200 et status ready', async () => {
    Object.assign(etatBase, {
      joignable: true,
      derniereErreur: null,
      derniereVerification: new Date(),
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.base).toBe('joignable');
  });

  test('base injoignable : 503, avec le message brut de pg', async () => {
    Object.assign(etatBase, {
      joignable: false,
      derniereErreur: 'getaddrinfo ENOTFOUND todo-db',
      derniereVerification: new Date(),
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    // Le detail est ce qui separe "nom introuvable" de "connexion refusee" de
    // "mot de passe invalide" : trois pannes, trois remedes.
    expect(res.body.detail).toBe('getaddrinfo ENOTFOUND todo-db');
  });

  test('et pendant ce temps /health continue de repondre ok', async () => {
    Object.assign(etatBase, { joignable: false, derniereErreur: 'base morte' });

    // C'EST LE TEST QUI DOCUMENTE LE CHOIX. /health ment, volontairement : les
    // deux sondes du pod sont branchees dessus, et un /health qui suivrait la
    // base ferait retirer les trois copies du Service au premier
    // ralentissement de Postgres. Une base LENTE deviendrait une application
    // TOTALEMENT indisponible.
    const health = await request(app).get('/health');
    const ready = await request(app).get('/ready');

    expect(health.status).toBe(200);
    expect(ready.status).toBe(503);
  });
});

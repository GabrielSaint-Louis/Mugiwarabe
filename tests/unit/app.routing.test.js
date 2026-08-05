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

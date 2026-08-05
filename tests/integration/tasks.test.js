'use strict';

// Tests d'integration : la vraie route HTTP, la vraie logique metier, la vraie
// base PostgreSQL. Aucun mock ici, et c'est tout l'interet.
//
// Un mock est pratique — pas de base a installer, quelques millisecondes par
// test — mais il ment. Il ne connait ni le schema reel, ni les types des
// colonnes, ni les contraintes, ni les erreurs qu'une vraie base renvoie. Il
// dit oui a tout, tout le temps. La suite unitaire couvre ce qu'elle peut
// couvrir honnetement (les refus du modele, la correspondance des erreurs) ;
// ce fichier couvre le reste, c'est-a-dire ce qu'un utilisateur vit vraiment.
const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/db');
const Task = require('../../src/models/task');

// Une connexion a une base peut demander plus que les 5 secondes accordees aux
// tests unitaires, surtout au premier appel d'un job de pipeline.
jest.setTimeout(20000);

// Chaque test repart d'un etat connu et vide. Sans ce nettoyage, le second
// passage de la suite echouerait sur les donnees laissees par le premier, et
// un test qui depend de ce qu'un autre a laisse derriere lui est un test
// instable qui finira par passer une fois sur deux.
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tasks');
});

afterAll(async () => {
  // Sans ca, Jest reste suspendu sur le pool ouvert et le job de la pipeline
  // n'en finit jamais.
  await pool.end();
});

describe('cycle de vie complet d une tache', () => {
  test('creer une tache, puis la relire par son id, et retrouver ce qui a ete envoye', async () => {
    const creation = await request(app)
      .post('/api/tasks')
      .send({ description: 'ecrire la procedure de deploiement', status: 'in_progress' });

    expect(creation.status).toBe(201);
    const { id } = creation.body;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);

    const relecture = await request(app).get(`/api/tasks/${id}`);

    expect(relecture.status).toBe(200);
    // On compare l'objet ENTIER, pas champ par champ. C'est la difference qui
    // compte : un `expect(body.description).toBe(...)` reste vert si un autre
    // champ disparait de la reponse, et c'est exactement la regression de la
    // phase 5 — le champ `status` retire de toTask(), 22 tests unitaires
    // toujours verts, et un client casse en production.
    expect(relecture.body).toEqual({
      id,
      description: 'ecrire la procedure de deploiement',
      status: 'in_progress',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  test('une tache creee sans status prend la valeur par defaut todo', async () => {
    const creation = await request(app).post('/api/tasks').send({ description: 'ranger le bureau' });

    expect(creation.status).toBe(201);
    expect(creation.body.status).toBe('todo');
  });

  test('modifier une tache change updatedAt et laisse createdAt tranquille', async () => {
    const { body: creee } = await request(app).post('/api/tasks').send({ description: 'relire' });

    const modif = await request(app).put(`/api/tasks/${creee.id}`).send({ status: 'done' });

    expect(modif.status).toBe(200);
    expect(modif.body.status).toBe('done');
    expect(modif.body.description).toBe('relire'); // le COALESCE fait son travail
    expect(modif.body.createdAt).toBe(creee.createdAt);
    expect(Date.parse(modif.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(creee.updatedAt));
  });

  test('supprimer une tache la fait disparaitre de la liste', async () => {
    const { body: gardee } = await request(app).post('/api/tasks').send({ description: 'gardee' });
    const { body: jetee } = await request(app).post('/api/tasks').send({ description: 'jetee' });

    const suppression = await request(app).delete(`/api/tasks/${jetee.id}`);
    expect(suppression.status).toBe(204);

    const liste = await request(app).get('/api/tasks');
    expect(liste.status).toBe(200);
    expect(liste.body.map((t) => t.id)).toEqual([gardee.id]);

    // Et elle ne se relit plus non plus : supprimee de la liste ET de la base,
    // pas seulement masquee.
    expect((await request(app).get(`/api/tasks/${jetee.id}`)).status).toBe(404);
  });
});

describe('ce que l API refuse, et avec quel code', () => {
  test('une tache qui n existe pas donne un 404 propre, jamais une erreur serveur', async () => {
    // Un UUID valide dans sa forme, absent de la base : le chemin qui passe
    // vraiment par une requete SQL, contrairement au test unitaire qui, lui,
    // s'arrete sur la garde de format.
    const res = await request(app).get('/api/tasks/00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'tache introuvable' });
  });

  test('un id qui n est meme pas un UUID donne 404, pas 500', async () => {
    // Sans la garde du modele, Postgres refuserait le cast et l'erreur
    // remonterait en 500 : une entree utilisateur ne doit jamais produire une
    // erreur serveur.
    const res = await request(app).get('/api/tasks/pas-un-uuid');

    expect(res.status).toBe(404);
  });

  test('un corps sans description donne un 400 qui nomme le champ manquant', async () => {
    const res = await request(app).post('/api/tasks').send({ status: 'todo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('description est obligatoire');
  });

  test('une description demesuree donne un 400, et rien n entre en base', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ description: 'x'.repeat(Task.MAX_DESCRIPTION_LENGTH + 1) });

    expect(res.status).toBe(400);

    // Le point qui compte : la validation protege vraiment la base. Sans elle,
    // la colonne VARCHAR(500) renverrait une erreur Postgres en 500, ou pire,
    // laisserait passer selon le type de colonne.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM tasks');
    expect(rows[0].n).toBe(0);
  });

  test('exactement la longueur limite passe, et arrive intacte en base', async () => {
    // Le cas limite promis par la suite unitaire, qui ne pouvait pas le
    // verifier : une entree valide continue jusqu'a la base. VARCHAR(500) et
    // MAX_DESCRIPTION_LENGTH doivent etre d'accord, sinon la validation dit
    // oui et Postgres dit non.
    const pile = 'x'.repeat(Task.MAX_DESCRIPTION_LENGTH);

    const res = await request(app).post('/api/tasks').send({ description: pile });

    expect(res.status).toBe(201);
    expect(res.body.description).toHaveLength(Task.MAX_DESCRIPTION_LENGTH);

    const relu = await request(app).get(`/api/tasks/${res.body.id}`);
    expect(relu.body.description).toBe(pile); // rien n'a ete tronque en chemin
  });

  test('un status inconnu donne un 400 qui liste les valeurs admises', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ description: 'valide', status: 'presque_fini' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('todo');
  });
});

describe('ce que seule une vraie base peut prouver', () => {
  test('une description avec une apostrophe n est pas une injection SQL', async () => {
    // Requetes parametrees : la valeur ne rejoint jamais la chaine SQL. Contre
    // un mock, ce test serait decoratif — le faux client ne parse aucun SQL.
    const mechant = "'; DROP TABLE tasks; --";

    const creation = await request(app).post('/api/tasks').send({ description: mechant });
    expect(creation.status).toBe(201);
    expect(creation.body.description).toBe(mechant);

    // La table existe toujours, et la tache est bien dedans.
    const liste = await request(app).get('/api/tasks');
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(1);
  });

  test('les taches sortent dans l ordre de creation', async () => {
    for (const d of ['premiere', 'deuxieme', 'troisieme']) {
      await request(app).post('/api/tasks').send({ description: d });
    }

    const { body } = await request(app).get('/api/tasks');

    // ORDER BY created_at ASC : c'est le contrat de la route, et il ne tient
    // que parce que la base sait ce qu'est un TIMESTAMPTZ.
    expect(body.map((t) => t.description)).toEqual(['premiere', 'deuxieme', 'troisieme']);
  });
});

'use strict';

// Le test que le TP designe comme celui qui compte : appeler trois fois la
// meme route, recharger /metrics, et voir le compteur avoir augmente de trois
// exactement. S'il augmente d'un seul, le compteur est mal place. S'il repart
// de zero, l'application a redemarre entre-temps.
//
// Il vit dans la suite d'integration et pas dans la suite unitaire parce que
// la jauge metier interroge vraiment la base.
const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/db');

jest.setTimeout(20000);

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tasks');
});

afterAll(async () => {
  await pool.end();
});

// Lit une valeur precise dans la page texte de /metrics. Ecrit a la main
// plutot qu'avec une librairie : savoir relire ce format a l'oeil est
// exactement la competence visee.
function valeur(page, ligneAttendue) {
  const ligne = page.split('\n').find((l) => l.startsWith(ligneAttendue));
  return ligne ? Number(ligne.slice(ligne.lastIndexOf(' ') + 1)) : 0;
}

async function page() {
  const res = await request(app).get('/metrics');
  expect(res.status).toBe(200);
  return res.text;
}

describe('la page /metrics', () => {
  test('repond en texte brut, jamais en JSON', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    // Le format d'echange de Prometheus. Un application/json ici, et la cible
    // passerait DOWN sans autre explication.
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('# HELP http_requests_total');
    expect(res.text).toContain('# TYPE http_requests_total counter');
  });

  test('trois appels a la meme route font monter le compteur de trois, exactement', async () => {
    const cle = 'http_requests_total{method="GET",route="/api/tasks",status="200"}';

    const avant = valeur(await page(), cle);

    await request(app).get('/api/tasks');
    await request(app).get('/api/tasks');
    await request(app).get('/api/tasks');

    expect(valeur(await page(), cle)).toBe(avant + 3);
  });

  test('une route inconnue est comptee elle aussi, mais sous un label fixe', async () => {
    const avant = valeur(await page(), 'http_requests_total{method="GET",route="(inconnue)",status="404"}');

    await request(app).get('/pas-une-route');
    await request(app).get('/wp-admin.php'); // ce qu'un scanner envoie toute la journee

    const texte = await page();

    // Comptees : sans ca, la moitie des erreurs serait invisible.
    expect(valeur(texte, 'http_requests_total{method="GET",route="(inconnue)",status="404"}')).toBe(
      avant + 2
    );

    // Mais JAMAIS sous leur URL. C'est le piege de la cardinalite : deux URL
    // inventees par l'appelant ne doivent pas creer deux series temporelles.
    expect(texte).not.toContain('/wp-admin.php');
    expect(texte).not.toContain('/pas-une-route');
  });

  test('l identifiant d une tache ne devient jamais un label', async () => {
    const { body: tache } = await request(app).post('/api/tasks').send({ description: 'mesuree' });

    await request(app).get(`/api/tasks/${tache.id}`);

    const texte = await page();

    // La route declaree, pas l'URL reelle. Une metrique par tache creee, et
    // Prometheus s'etouffe au bout de quelques milliers de taches.
    expect(texte).toContain('route="/api/tasks/:id"');
    expect(texte).not.toContain(tache.id);
  });

  test('l histogramme de duree expose de quoi calculer un p95', async () => {
    await request(app).get('/api/tasks');

    const texte = await page();

    // _bucket, _sum et _count : les trois series qu'un histogramme produit, et
    // histogram_quantile() a besoin des _bucket.
    expect(texte).toContain('http_request_duration_seconds_bucket');
    expect(texte).toContain('http_request_duration_seconds_sum');
    expect(texte).toContain('http_request_duration_seconds_count');
  });
});

describe('les metriques metier', () => {
  test('creer deux taches fait monter le compteur metier de deux', async () => {
    const avant = valeur(await page(), 'todo_tasks_created_total');

    await request(app).post('/api/tasks').send({ description: 'une' });
    await request(app).post('/api/tasks').send({ description: 'deux' });

    expect(valeur(await page(), 'todo_tasks_created_total')).toBe(avant + 2);
  });

  test('une creation refusee ne fait pas monter le compteur', async () => {
    const avant = valeur(await page(), 'todo_tasks_created_total');

    await request(app).post('/api/tasks').send({ status: 'todo' }); // 400, description absente

    // Un compteur qui monte alors que la base a refuse la ligne raconte une
    // histoire fausse, et c'est ce genre d'ecart qui fait perdre une
    // demi-heure pendant une astreinte.
    expect(valeur(await page(), 'todo_tasks_created_total')).toBe(avant);
  });

  test('la jauge reflete l etat present de la base, par etat', async () => {
    await request(app).post('/api/tasks').send({ description: 'a faire' });
    await request(app).post('/api/tasks').send({ description: 'en cours', status: 'in_progress' });
    await request(app).post('/api/tasks').send({ description: 'aussi en cours', status: 'in_progress' });

    const texte = await page();

    expect(valeur(texte, 'todo_tasks_in_database{status="todo"}')).toBe(1);
    expect(valeur(texte, 'todo_tasks_in_database{status="in_progress"}')).toBe(2);
    // Etat sans aucune tache : la jauge doit dire 0, pas disparaitre. Une
    // serie qui s'efface laisserait le panneau afficher sa derniere valeur
    // connue indefiniment.
    expect(valeur(texte, 'todo_tasks_in_database{status="done"}')).toBe(0);
  });

  test('la jauge redescend quand les taches disparaissent', async () => {
    const { body: t } = await request(app).post('/api/tasks').send({ description: 'ephemere' });
    expect(valeur(await page(), 'todo_tasks_in_database{status="todo"}')).toBe(1);

    await request(app).delete(`/api/tasks/${t.id}`);

    // C'est la difference entre une jauge et un compteur : la premiere decrit
    // un etat present, la seconde un cumul. Confondre les deux donne des
    // panneaux qui ne redescendent jamais.
    expect(valeur(await page(), 'todo_tasks_in_database{status="todo"}')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
//  todo_db_up, la metrique ajoutee au jour 4
//
//  Elle vit dans la suite d'integration et pas dans l'unitaire, contrairement
//  aux tests de /ready : ici on veut verifier que la surveillance interroge
//  VRAIMENT la base, pas qu'elle relit correctement un cache.
// ---------------------------------------------------------------------------
describe('todo_db_up dit si la base repond a cette copie', () => {
  const { verifierBase } = require('../../src/db');

  test('base joignable : la metrique vaut 1', async () => {
    // On force une verification plutot que d'attendre le tick de 10 s : un
    // test qui dort dix secondes est un test qu'on finit par desactiver.
    await verifierBase();

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^todo_db_up 1$/m);
  });

  test('elle est exposee avec son aide, lisible sans documentation', async () => {
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('# HELP todo_db_up');
    expect(res.text).toContain('# TYPE todo_db_up gauge');
  });
});

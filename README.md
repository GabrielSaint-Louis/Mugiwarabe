# Todo API — TP DevOps / Docker, jour 1

Projet fil rouge du TP « Initiation à la méthodologie DevOps, GitLab CI/CD et
conteneurisation Docker ». Une API de gestion de tâches Node.js, dockerisée de
bout en bout : Dockerfile de production, PostgreSQL persistant, réseau isolé,
stack orchestrée par Docker Compose, second service en Python, et images
publiées sur un registry.

## Ce que fait le projet

Une API REST qui manipule des `Task`. Chaque tâche porte un `id` (UUID), une
`description`, un `status` (`todo`, `in_progress`, `done`), un `createdAt` et un
`updatedAt`.

| Méthode  | Route                 | Rôle                        |
| -------- | --------------------- | --------------------------- |
| `GET`    | `/health`             | Sonde de santé              |
| `POST`   | `/api/tasks`          | Créer une tâche             |
| `GET`    | `/api/tasks`          | Lister toutes les tâches    |
| `GET`    | `/api/tasks/:id`      | Voir une tâche              |
| `PUT`    | `/api/tasks/:id`      | Modifier une tâche          |
| `DELETE` | `/api/tasks/:id`      | Supprimer une tâche         |

## Lancer le projet

```bash
docker build -t todo-api:1.0.0 .
docker run --rm -p 3000:3000 todo-api:1.0.0
curl http://localhost:3000/health
```

## Structure

```
tp-devops-todo-api/
├── src/
│    ├── routes/tasks.js          # les 5 routes REST
│    ├── models/task.js           # stockage + validation des entrées
│    ├── middleware/errorHandler.js
│    ├── app.js                   # câblage express
│    └── server.js                # démarrage + arrêt propre sur SIGTERM
├── tests/                        # plus tard dans la semaine
├── Dockerfile                    # image de production
├── Dockerfile.simple             # le brouillon, gardé comme référence de mesure
├── .dockerignore
└── package.json
```

---

# Journal de bord

## Socle — la Todo API

CRUD testé avec les 3 cas demandés, tous passent :

| Cas                                          | Attendu | Obtenu                                                          |
| -------------------------------------------- | ------- | --------------------------------------------------------------- |
| `POST` puis `GET /api/tasks`                 | la tâche avec son `id` | UUID généré, tâche listée                          |
| `GET /api/tasks/<id inexistant>`             | 404 propre | `404 {"error":"tache introuvable"}`, process toujours vivant   |
| `POST` avec JSON malformé                    | 400 clair | `400 {"error":"corps de requete JSON invalide"}`                |
| `POST` avec description de 50 000 caractères | 400 clair | `400 {"error":"description est limitee a 500 caracteres (recue : 50000)"}` |

**Ce qui a cassé, et pourquoi.** Premier accroc, sur le corps JSON malformé : la
requête renvoyait bien un statut d'erreur, mais avec la page HTML de stacktrace
par défaut d'Express, pas du JSON. Un client qui parse la réponse en JSON casse
dessus. Corrigé en centralisant tout dans `errorHandler`, qui reconnaît le
`err.type === 'entity.parse.failed'` levé par body-parser et le traduit en 400
JSON.

Second point, celui de l'exemple du TP : sans limite explicite, une description
de 50 000 caractères est acceptée et stockée telle quelle. Deux barrières ont été
posées plutôt qu'une, parce qu'elles ne protègent pas de la même chose :
`express.json({ limit: '100kb' })` refuse le corps avant même de le parser (413,
protège la mémoire du process), et la validation métier borne la description à
500 caractères (400, message exploitable par le client). Les 50 000 caractères
tombent sur la seconde, ce qui donne un message précis plutôt qu'un refus opaque.

**Choix assumé sur le modèle.** Le TP donne le modèle `Task` avec un champ
`description`, mais l'exemple `curl` du chapitre 6 poste un champ `title`. J'ai
retenu `description`, qui est la définition du modèle de données, et c'est ce que
lit le service Python du chapitre 8.

## Chapitre 5 — Dockerfile de production

Les cinq vérifications demandées, chacune avec la commande qui la prouve :

| Vérification              | Commande                                        | Résultat                                     |
| ------------------------- | ----------------------------------------------- | -------------------------------------------- |
| Image de base épinglée    | `grep ^FROM Dockerfile`                          | `node:20.19.5-alpine`, aucun tag flottant     |
| `.dockerignore` complet   | `docker run --rm todo-api:1.0.0 ls -a`           | `node_modules package.json src` — ni `.git`, ni `.env`, ni logs |
| Process non-root          | `docker run --rm todo-api:1.0.0 sh -c whoami`    | `node`                                        |
| Multi-stage sans deps dev | `docker run --rm todo-api:1.0.0 sh -c "ls node_modules \| grep -c jest"` | `0`             |
| Cache protégé             | modif de `src/server.js` seul, puis rebuild      | `RUN npm ci --omit=dev` → `CACHED`            |

**Mesures avant / après.**

|                          | `Dockerfile.simple` (brouillon) | `Dockerfile` (production) |
| ------------------------ | -------------------------------- | -------------------------- |
| Somme des couches        | 151,0 Mo                         | **148,3 Mo**               |
| Content size (au `pull`) | 49,3 Mo                          | **48,5 Mo**                |
| Disk usage (Docker 29)   | 200 Mo                           | 197 Mo                     |
| Contexte transféré       | 2,51 Mo                          | **39,1 ko**                |
| Build à froid            | 6,26 s                           | 6,50 s                     |
| Build à chaud            | 0,63 s                           | 1,09 s                     |
| Utilisateur du process   | `root`                           | `node`                     |
| Contenu de `/app`        | `.git`, `node_modules` de l'hôte, `tests`, `stats_api`… | `node_modules`, `package.json`, `src` |

**Ce qui a cassé : la métrique elle-même.** `docker images` affichait 197 Mo pour
une image censée passer sous les 150 Mo, et rien ne bougeait quoi que je retire.
Docker 29 a en fait scindé l'ancienne colonne `SIZE` en deux : `DISK USAGE`
(197 Mo, l'occupation réelle sur disque avec le snapshotter containerd) et
`CONTENT SIZE` (48,5 Mo, ce qui transite réellement au `pull`). La mesure
historiquement affichée par `docker images`, c'est la somme des couches de
`docker history` : 148,3 Mo. Les trois sont notées ci-dessus, parce que citer un
seul de ces chiffres sans dire lequel ne veut rien dire.

**Le gain n'est pas là où on l'attend.** Sur la taille, l'écart brouillon →
production est ridicule : 2,7 Mo, parce que l'image de base pèse à elle seule
148 Mo sur les 148,3, et que ce projet n'a aucune étape de compilation à jeter.
Le vrai gain est ailleurs, et il est massif : le contexte de build passe de
2,51 Mo à 39,1 ko (**64 fois moins**) grâce au `.dockerignore`, le process ne
tourne plus en root, et le `.git` complet ne part plus dans l'image — c'est-à-dire
tout l'historique du dépôt, lisible par quiconque récupère l'image.

**Une contre-mesure honnête.** Le build à chaud est passé de 0,63 s à 1,09 s. Le
multi-stage ajoute un étage à évaluer, même entièrement caché. C'est une
régression réelle sur cette métrique, assumée : elle achète l'absence de cache npm
et de devDependencies dans l'image finale.

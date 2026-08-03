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

## Chapitre 6 — Networks et Volumes

### Mission A — la persistance

La commande exacte qui lance Postgres, à la main :

```bash
docker volume create todo-pgdata
docker run -d --name todo-postgres \
  -e POSTGRES_DB=todo_db \
  -e POSTGRES_USER=todo_user \
  -e POSTGRES_PASSWORD=todo_pass \
  -v todo-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

**IP interne trouvée** : `172.17.0.2`, sur le réseau `bridge` par défaut, relevée avec
`docker inspect todo-postgres --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`.
Cette IP a dû être écrite en dur dans `src/db.js`, puisque sur le bridge par défaut
`getent hosts todo-postgres` ne résout rien du tout.

**Le nombre d'étapes manuelles.** Pour obtenir deux conteneurs qui se parlent :
`docker volume create`, puis un `docker run` de 6 lignes pour Postgres, puis un
`docker inspect` pour lire l'IP, puis une **modification du code source** pour y
coller cette IP, puis un `docker build`, puis un `docker run` pour l'API. Six
étapes, dont une qui touche au code applicatif — et tout est à refaire dès que le
conteneur Postgres est recréé, puisque l'IP change. Un seul fichier déclaratif
ferait la même chose sans qu'on ait à lire quoi que ce soit à la main.

**Les trois tests de persistance.**

| Scénario | Résultat |
| --- | --- |
| `docker stop` puis `docker start` de Postgres | tâche toujours présente |
| `docker rm` puis un conteneur **tout neuf** sur le même volume | tâche toujours présente |
| `docker volume rm` sur un volume jetable (`todo-logs`) | 0 fichier retrouvé, données perdues pour de bon |

La troisième ligne est celle qui compte : elle situe exactement la frontière entre
« je change de conteneur » et « je perds mes données ».

**Cas adverse : la base tuée en pleine écriture.** `docker kill todo-postgres`
pendant un `POST` renvoie `503 {"error":"base de donnees injoignable, reessayez
plus tard"}` en **3,0 s** — exactement le `connectionTimeoutMillis` fixé dans le
pool. L'API reste vivante (`/health` répond), et se reconnecte seule au
`docker start` sans redémarrage.

**Ce qui a cassé.** Premier essai : `docker kill` sur Postgres tuait aussi le
process Node. Un client inactif du pool `pg` émet un événement `error` sur le pool
quand la connexion tombe ; sans handler `pool.on('error')`, Node traite ça comme
une exception non gérée et termine le process. L'API entière disparaissait parce
que la base avait redémarré. Deuxième point : sans `connectionTimeoutMillis`, la
requête restait pendante indéfiniment côté client au lieu de renvoyer une erreur.

### Mission B — l'isolation réseau

```bash
docker network create todo-network
```

Nom retenu : **`todo-network`**. `src/db.js` vise maintenant `host: 'todo-postgres'`,
le nom du conteneur, résolu par le DNS interne du network custom
(`getent hosts todo-postgres` → `172.18.0.2`). Plus une seule IP dans le code.
Postgres est lancé sans `-p` : `docker port todo-postgres` ne renvoie rien.

**Ce qui a cassé : la vérification elle-même.** Le TP propose de vérifier
l'isolation avec `psql -h localhost -U todo_user -d todo_db`, ou à défaut
`nc -zv localhost 5432`. Sur cette machine, `nc` répond **`succeeded`** — et
pourtant l'isolation est correcte. La raison : un PostgreSQL système tourne déjà
sur `127.0.0.1:5432`, sans rapport avec le TP. Le test tombe sur lui.

Un test de port ne prouve donc rien tout seul dès que la machine héberge déjà le
même service. Quatre vérifications ont remplacé celle-là :

| Vérification | Résultat |
| --- | --- |
| `docker port todo-postgres` | sortie vide, aucun port publié |
| `ss -tlnp \| grep 5432` | un seul `LISTEN` sur `127.0.0.1`, aucun `docker-proxy` |
| `psql -h localhost -U todo_user` | `FATAL: password authentication failed` → c'est le Postgres système, pas le nôtre |
| depuis un conteneur **sur** `todo-network` | `connexion ok depuis todo-network, 1 tache(s)` |
| depuis un conteneur **hors** du network | `could not translate host name "todo-postgres"` |

Les deux dernières lignes sont le vrai test : un contrôle positif et un contrôle
négatif. Sans le contrôle positif, un test qui échoue ne dit pas si l'isolation
fonctionne ou si la commande est simplement mal écrite.

**Exercices guidés.** Le ping par nom entre `serveur` et `client` sur
`app-network` passe (`172.18.0.2`, 0% packet loss) ; le même ping vers `isole`,
placé sur `other-network`, échoue avec `ping: bad address 'isole'`. Le volume
`todo-logs` a bien survécu à la suppression de `todo-writer` et `todo-reader`,
relu tel quel par un `todo-checker` créé après coup, et vit sur l'hôte dans
`/var/lib/docker/volumes/todo-logs/_data`.

## Chapitre 7 — Docker Compose et la configuration

### Mission A — la configuration sort du code

`src/config.js` est devenu le point unique de lecture de l'environnement. Le
code de connexion ne contient plus aucune valeur en dur : ni l'IP `172.17.0.2`
du chapitre 6, ni le nom `todo-postgres` qui l'avait remplacée, ni les
identifiants. `git log --all -- .env` ne renvoie rien : le `.env` n'a jamais été
commité, seul `.env.example` l'est.

Retirer une variable obligatoire fait échouer le démarrage net :

```
Error: Variable d'environnement obligatoire manquante : DB_PASSWORD.
       Copiez .env.example vers .env et renseignez-la.
    at required (/app/src/config.js:15:11)
```

Code de sortie `1`, message qui nomme la variable et dit quoi faire. C'est très
exactement ce qu'on veut à la place d'un `undefined` qui se propage jusqu'à une
erreur illisible du driver Postgres.

### Mission B — toute la stack dans un fichier

`docker compose up -d` crée les **5 ressources** attendues : le network
`todo-network`, le volume `todo_pgdata`, et les trois conteneurs `db`,
`todo-api`, `adminer`. Adminer répond en HTTP 200 et se connecte à la base avec
le service `db` comme serveur.

**Le healthcheck Postgres passe `Healthy` en 5,2 s, dès la première sonde.** Le
temps n'est pas celui de Postgres, qui est prêt en moins d'une seconde sur un
data dir existant : c'est le `start_period: 5s` qui retarde la première sonde.
Le `up -d` complet prend 12 s de bout en bout.

**Les ajustements de noms entre le chapitre 6 et Compose.** Deux à noter :

- le **network** n'a pas bougé, mais uniquement parce que `name: todo-network`
  est déclaré explicitement. Sans cette ligne, Compose l'aurait préfixé du nom
  de projet et créé un `todo_todo-network` à côté de celui du chapitre 6 ;
- le **volume**, lui, a changé. Le chapitre 6 avait créé `todo-pgdata` à la
  main ; Compose gère `pgdata`, qu'il préfixe en `todo_pgdata`. Ce sont deux
  volumes distincts, donc la première requête sur la stack Compose a renvoyé
  `[]` alors que la tâche du chapitre 6 existait toujours. Rien n'est perdu —
  `todo-pgdata` est toujours là — mais c'est le genre de détail qui fait croire
  à une perte de données pendant trente secondes.

**Variables ajoutées en cours de route.** `.env.example` a gagné trois clés qui
n'existaient pas au chapitre 6 : `API_PORT`, `ADMINER_PORT` et `STATS_PORT`. Elles
sont volontairement distinctes de `PORT` : `PORT` est le port d'écoute *dans* le
conteneur, `API_PORT` le port publié *sur l'hôte*. Cette séparation a servi
immédiatement — 3000 et 3001 sont déjà pris sur cette machine par une autre
application. Le `.env` local publie donc sur 8080, 8081 et 8082, **sans une seule
modification de l'image ni du `docker-compose.yml`**. C'est très concrètement ce
que la configuration externalisée achète.

### Les trois scénarios

**Nominal.** Les trois conteneurs passent `running`, `db` en `healthy`, et
`GET /api/tasks` renvoie du JSON.

**Cas limite : `DB_PASSWORD` retirée du `.env`.** Le TP annonce que Postgres
refusera de démarrer, que son healthcheck échouera en boucle, et que l'API
restera bloquée en `created` sans jamais démarrer. **Ce n'est pas ce qui s'est
passé ici**, et l'écart est instructif :

| | Prédit par le TP | Observé |
| --- | --- | --- |
| `db` | refuse de démarrer, healthcheck en échec | `Up (healthy)`, démarre normalement |
| `todo-api` | bloquée en `created` | `Restarting (1)`, crash-loop |

La raison tient en une ligne des logs de Postgres : `PostgreSQL Database
directory appears to contain a database; Skipping initialization`.
`POSTGRES_PASSWORD` n'est lu qu'au tout premier `initdb`. Sur un volume déjà
initialisé, la variable est ignorée et le conteneur démarre avec le mot de passe
d'origine. La prédiction du TP suppose un volume vierge.

C'est donc l'API qui a bloqué, et par son propre garde-fou : le `required()` de
`config.js` lève, le process sort en 1, et `restart: unless-stopped` le relance
en boucle. Compose avait d'ailleurs prévenu en amont :
`warning: The "DB_PASSWORD" variable is not set. Defaulting to a blank string.`
Le résultat final est le même — la stack ne part pas silencieusement en marche
dégradée — mais le service qui bloque n'est pas celui annoncé.

**Cas adverse : la base tombe pendant que tout tourne.** `docker compose stop db`
puis un `GET /api/tasks` renvoie `503 {"error":"base de donnees injoignable,
reessayez plus tard"}` en **3,0 s** (le `connectionTimeoutMillis` du pool).
`/health` continue de répondre 200 : le conteneur n'est pas mort avec sa base.
Après `docker compose start db`, l'API **retrouve seule** le chemin de la base,
sans redémarrage — le pool `pg` rouvre une connexion au premier appel suivant.

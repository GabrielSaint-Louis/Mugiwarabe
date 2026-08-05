# Todo API — TP DevOps / Docker, jours 1 à 3

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

La stack complète compte quatre services : l'API Node.js, une base PostgreSQL,
un service Python `stats-api` qui compte les tâches par état, et Adminer pour
inspecter la base à la souris.

| Service     | Rôle                                | Port hôte (par défaut) |
| ----------- | ----------------------------------- | ---------------------- |
| `todo-api`  | l'API REST Node.js                  | `${API_PORT}` → 3000   |
| `db`        | PostgreSQL 16                       | **aucun**, volontairement |
| `stats-api` | statistiques par état (FastAPI)     | `${STATS_PORT}` → 8000 |
| `adminer`   | interface web d'admin de la base    | `${ADMINER_PORT}` → 8080 |

## Lancer le projet

### Depuis les sources

```bash
cp .env.example .env        # puis renseigner DB_PASSWORD
docker compose up -d
```

Toute la stack démarre en une commande. Les ports publiés sont pilotés par le
`.env` : sur une machine où 3000 est déjà pris, il suffit d'y écrire
`API_PORT=8080`, sans toucher ni à l'image ni au fichier compose.

```bash
curl http://localhost:${API_PORT:-3000}/health
curl http://localhost:${API_PORT:-3000}/api/tasks
curl http://localhost:${STATS_PORT:-8000}/stats
```

### Depuis le registry, sans le code source

Le vrai test de la séparation build / run. Dans un dossier vide contenant
uniquement `docker-compose.prod.yml` et un `.env` :

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Publier de nouvelles images

```bash
docker compose build
docker tag  todo-todo-api:latest  $IMAGE_PREFIX/todo-api:1.0.0
docker tag  todo-stats-api:latest $IMAGE_PREFIX/stats-api:1.0.0
docker push $IMAGE_PREFIX/todo-api:1.0.0
docker push $IMAGE_PREFIX/stats-api:1.0.0
```

### Mesurer

```bash
./scripts/measure.sh todo-api  .           http://127.0.0.1:8080/health
./scripts/measure.sh stats-api ./stats_api http://127.0.0.1:8081/health
```

### Tester

```bash
npm test                 # 22 cas unitaires, aucune base nécessaire
npm run lint

# Les 21 cas d'intégration ont besoin d'un vrai PostgreSQL :
docker run -d --name pg-test -p 127.0.0.1:15432:5432 \
  -e POSTGRES_DB=todo_test -e POSTGRES_USER=todo_user -e POSTGRES_PASSWORD=todo_pass \
  postgres:16-alpine
export DB_HOST=127.0.0.1 DB_PORT=15432 DB_NAME=todo_test DB_USER=todo_user DB_PASSWORD=todo_pass
npm run migrate && npm run test:integration
```

### Déployer (jour 3)

Il n'y a rien à taper : un push sur `main` déclenche lint, tests, tests
d'intégration, construction de l'image, publication sur GHCR taguée au sha, et
déploiement sur la machine cible. Compter 1 min 15.

La machine cible est une maquette locale — un conteneur qui embarque son propre
Docker et un `sshd` :

```bash
./deploy/vm-prod.sh up       # la construire et la démarrer
./deploy/vm-prod.sh status   # est-ce qu'elle répond
./deploy/vm-prod.sh ssh      # ouvrir un shell dessus
```

| Service | URL (sur le serveur uniquement) | Tunnel depuis un poste |
| --- | --- | --- |
| API | `http://127.0.0.1:13000` | `ssh -L 13000:127.0.0.1:13000 <serveur>` |
| Prometheus | `http://127.0.0.1:19090` | `ssh -L 19090:127.0.0.1:19090 <serveur>` |
| Grafana | `http://127.0.0.1:13001` | `ssh -L 13001:127.0.0.1:13001 <serveur>` |

Déployer une version précise, ou revenir à la précédente — **même commande** :

```bash
./deploy/vm-prod.sh ssh '/srv/todo/apply.sh <sha-du-commit>'
```

En cas de panne, tout est dans **[`docs/PROCEDURE_DEPLOIEMENT.md`](docs/PROCEDURE_DEPLOIEMENT.md)** :
les signatures des six pannes connues, la commande de retour arrière et son
critère de déclenchement.

## Structure

```
tp-devops-todo-api/
├── src/
│    ├── routes/tasks.js          # les 5 routes REST
│    ├── models/task.js           # accès base + validation des entrées
│    ├── middleware/errorHandler.js
│    ├── db.js                    # pool PostgreSQL + création du schéma
│    ├── config.js                # point unique de lecture de l'environnement
│    └── app.js                   # câblage express
├── stats_api/                    # le service Python
│    ├── main.py
│    ├── requirements.txt
│    └── Dockerfile
├── .github/workflows/
│    ├── ci.yml                   # J3 : lint, tests, intégration, image, déploiement
│    └── runner-check.yml         # J3 : la preuve de où tourne un job
├── deploy/                       # J3 — tout ce qui concerne la machine cible
│    ├── Dockerfile.vm            # la machine de production, en maquette
│    ├── vm-prod.sh               # la construire, la démarrer, s'y connecter
│    ├── compose.yml              # la stack de prod : API, base, Prometheus, Grafana
│    ├── apply.sh                 # déployer ET revenir en arrière, même commande
│    ├── incident.sh              # les 5 pannes de l'exercice d'astreinte
│    ├── prometheus.yml
│    ├── grafana/                 # source de données et tableau de bord, en fichiers
│    ├── env.example              # modèle du .env posé à la main sur la cible
│    └── deploy_key.pub           # la privée n'est PAS ici, et ne le sera jamais
├── docs/PROCEDURE_DEPLOIEMENT.md # J3 : ce qu'on lit à 3 h du matin
├── scripts/
│    ├── measure.sh               # les 4 métriques du chapitre 10
│    ├── releve.sh                # J3 : une ligne du tableau de relevés
│    └── charge.sh                # J3 : du trafic, pour que les panneaux bougent
├── exercices/j2-echauffement/    # les 4 fichiers cassés du J2 et leurs corrigés
├── tests/
│    ├── unit/                    # 22 cas, sans base
│    └── integration/             # 21 cas, contre un vrai PostgreSQL
├── Dockerfile                    # image de production
├── Dockerfile.simple             # le brouillon, gardé comme référence de mesure
├── docker-compose.yml            # stack de dev, construite depuis les sources
├── docker-compose.prod.yml       # stack de prod, tirée du registry
├── .env.example                  # template commité (le .env, jamais)
└── .dockerignore
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

## Chapitre 8 — Le service Python stats-api

Pas une ligne de Python à écrire : `main.py` et `requirements.txt` sont repris
tels quels du TP. Tout le travail était dans le branchement, et il s'est trouvé
que les deux points d'attention annoncés ne demandaient aucune correction :

- `TABLE_NAME = "tasks"` et `STATUS_COLUMN = "status"` correspondent déjà au
  schéma créé au chapitre 6 ;
- les clés lues par `get_connection()` (`DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`) sont exactement celles du `.env` du chapitre 7.

Ce n'est pas de la chance : le schéma du chapitre 6 et les noms de variables du
chapitre 7 ont été choisis en lisant d'abord ce que le chapitre 8 allait
attendre. C'est le seul « travail de réflexion » réel du chapitre, et il a été
fait deux chapitres plus tôt.

Deux ajouts au Dockerfile fourni : la base est épinglée au patch
(`python:3.12.8-slim` plutôt que `python:3.12-slim`), par cohérence avec la règle
du chapitre 5, et un `stats_api/.dockerignore` a été ajouté — le `COPY . .` du
Dockerfile donné embarquerait sinon `__pycache__` et tout `.env` local.

`docker network inspect todo-network` liste bien les quatre conteneurs :
`todo-db-1`, `todo-todo-api-1`, `todo-stats-api-1`, `todo-adminer-1`.

### Checklist de sortie

| Cas | Attendu | Obtenu |
| --- | --- | --- |
| Nominal | compteurs = contenu réel de la table | `/stats` → `{"todo":2,"in_progress":1,"done":1}`, `COUNT` SQL manuel → `{"todo":2,"done":1,"in_progress":1}` — identiques |
| Limite : table vide | 200 avec des zéros | `{"todo":0,"in_progress":0,"done":0}` en HTTP 200 |
| Adverse : `docker compose stop db` | erreur claire, pas de stacktrace | `503 {"detail":"stats-api ne parvient pas a joindre la base de donnees"}` |

**Une différence de comportement entre les deux services, sur le même incident.**
Base coupée, `stats-api` répond 503 en **4 ms**, là où `todo-api` met **3,0 s**
pour la même panne. Ce n'est pas une lenteur de Node : c'est le `connectionTimeoutMillis: 3000`
du pool `pg`, qui attend l'expiration du délai avant d'abandonner, alors que
`psycopg2` remonte immédiatement l'échec de résolution du nom. Les deux réponses
sont correctes, mais un client qui appelle les deux services verra deux profils
de latence très différents en cas de panne — de quoi fausser un timeout côté
appelant si on ne le sait pas.

**Un test hors checklist.** J'ai inséré directement en base une tâche avec un
`status` absent de `KNOWN_STATUSES` (`archived`), pour voir si la ligne
`counts[status] = count` du code fourni cassait. Elle ne casse pas : Python crée
simplement la clé, et `/stats` répond `{"todo":0,"in_progress":0,"done":0,"archived":1}`
en 200. Le service est donc plus robuste que prévu sur ce point — l'état inconnu
apparaît comme clé supplémentaire au lieu de faire tomber la requête. À garder en
tête tout de même : un client qui suppose exactement trois clés dans la réponse
serait pris au dépourvu.

## Chapitre 9 — Publier les images et redéployer

### Le registry retenu, et pourquoi

Premier essai sur **GHCR** (GitHub Container Registry), puisque le dépôt est déjà
sur GitHub. Le `docker login ghcr.io` réussit avec le token de la CLI `gh`, mais
le push échoue :

```
error from registry: permission_denied: The token provided does not match expected scopes.
```

Le token de `gh auth` porte `repo`, `workflow`, `read:org` — pas `write:packages`,
qui est le scope exigé pour publier un package. Un `gh auth refresh -s write:packages`
le corrigerait, mais demande une validation navigateur.

J'ai donc pris la seconde option que le TP autorise explicitement (« un registry
public ou privé ») : un **registry privé local**, l'image officielle `registry:2`.

```bash
docker run -d --name tp-registry --restart unless-stopped \
  -p 127.0.0.1:5000:5000 registry:2
```

Le `-p 127.0.0.1:5000:5000` n'est pas cosmétique : un `-p 5000:5000` exposerait un
registry **sans authentification** sur toutes les interfaces de la machine.
Publier sur la loopback uniquement le rend joignable par le daemon Docker local,
et par personne d'autre.

### Tag et push

```bash
docker tag  todo-todo-api:latest  localhost:5000/gabrielsaint-louis/todo-api:1.0.0
docker tag  todo-stats-api:latest localhost:5000/gabrielsaint-louis/stats-api:1.0.0
docker push localhost:5000/gabrielsaint-louis/todo-api:1.0.0
docker push localhost:5000/gabrielsaint-louis/stats-api:1.0.0
```

Le registry confirme :

```
{"repositories":["gabrielsaint-louis/stats-api","gabrielsaint-louis/todo-api"]}
{"name":"gabrielsaint-louis/todo-api","tags":["1.0.0"]}
```

Aucune image n'est poussée en `latest`, volontairement : sur un registry partagé,
`latest` change de contenu à chaque push sans qu'aucune version ne le distingue
du précédent. `1.0.0` est le seul moyen de savoir ce qui tourne réellement.

`docker-compose.prod.yml` ne référence le registry qu'à travers `${IMAGE_PREFIX}`.
Basculer vers Docker Hub ou GHCR, le jour où les identifiants sont disponibles, ne
demande de changer qu'une ligne du `.env` — pas le fichier compose.

### Le test qui compte

Dans `/tmp/deploy-depuis-registry`, un dossier ne contenant **que**
`docker-compose.prod.yml` et `.env`, après suppression de toutes les images
locales de l'application :

```
docker compose -f docker-compose.prod.yml up -d      →  7,5 s
```

| Service | Image | État |
| --- | --- | --- |
| `db` | `postgres:16-alpine` | `Up (healthy)` |
| `todo-api` | `localhost:5000/gabrielsaint-louis/todo-api:1.0.0` | `Up (healthy)` |
| `stats-api` | `localhost:5000/gabrielsaint-louis/stats-api:1.0.0` | `Up` |
| `adminer` | `adminer:4.8.1` | `Up` |

`POST /api/tasks` crée une tâche, `GET /api/tasks` la renvoie, `/stats` compte
`{"todo":0,"in_progress":0,"done":1}`, Adminer répond 200. Pas une ligne de code
source sur la machine. C'est le *build once, deploy everywhere* rendu concret.

### Cas adverse : un secret dans une couche ?

`docker history --no-trunc` sur les deux images publiées, filtré sur
`password|secret|token|todo_pass` :

- `todo-api` : **0 occurrence** ;
- `stats-api` : **1 occurrence**, qui est un faux positif —
  `RUN adduser --disabled-password --gecos "" appuser`, la ligne du Dockerfile
  fourni par le TP qui crée l'utilisateur non-root. Le mot « password » y apparaît
  comme nom d'option, pas comme valeur.

Aucun `.env`, aucune valeur de mot de passe, aucun jeton dans l'historique des
deux images. Ce que le `.dockerignore` de chaque service garantissait en amont,
`docker history` le confirme en aval.

## Chapitre 10 — Mesurer et optimiser

Les mesures ne sont pas relevées à la main : `scripts/measure.sh` enchaîne
`docker builder prune -af`, un build à froid, un build à chaud, la lecture des
tailles et des couches, puis une boucle `curl` toutes les 100 ms jusqu'au premier
200. Une mesure qu'on ne peut pas rejouer n'est pas une mesure.

### Le tableau

| Image | Taille | Couches (poids max) | Build froid / chaud | Temps 1re réponse HTTP |
| --- | --- | --- | --- | --- |
| `todo-api` | **149,4 Mo** <br><sub>48,7 Mo au `pull` · 198 Mo sur disque</sub> | 18 <br><sub>la plus lourde : **129,0 Mo**</sub> | 6,24 s / **1,00 s** | **0,68 s** |
| `stats-api` | **165,2 Mo** <br><sub>53,5 Mo au `pull` · 219 Mo sur disque</sub> | 21 <br><sub>la plus lourde : **85,2 Mo**</sub> | 8,73 s / **0,48 s** | **1,56 s** |

Les deux cibles du TP sont tenues : `todo-api` sous 150 Mo (149,4) avec un build
à chaud sous 5 s (1,00 s), `stats-api` sous 180 Mo (165,2).

**Ce que la colonne « poids max » révèle, et que la taille totale cache.** Sur
`todo-api`, une seule couche pèse 129,0 Mo sur les 149,4 : c'est le runtime Node
de l'image de base. Tout le code applicatif, dépendances comprises, tient dans
4,8 Mo. Autrement dit, **86 % de l'image ne m'appartient pas** et aucune
optimisation de mon Dockerfile n'y touchera. Sur `stats-api`, la plus grosse
couche est le `pip install` (85,2 Mo) : là, il y a matière.

### Trois optimisations tentées, trois résultats

**1. Retirer npm de l'image finale de `todo-api`** — `RUN rm -rf /usr/local/lib/node_modules/npm`
avant le `USER node`. npm ne sert à rien au runtime.

> **Régression.** 48 661 820 → 48 662 525 octets, soit **+705 octets**. `which npm`
> répond bien « absent », mais les fichiers restent intégralement dans la couche
> inférieure : un `rm` dans un Dockerfile n'efface rien, il ajoute une couche de
> masquage de 24,6 ko. Une couche de plus (18 → 19), et zéro octet gagné. C'est
> exactement le mécanisme qui fait qu'un `COPY .env` suivi d'un `RUN rm .env`
> laisse le secret lisible dans `docker history`. Abandonné.

**2. Passer `stats-api` en multi-stage** — un étage `builder` avec
`pip install --prefix=/install`, puis `COPY --from=builder /install /usr/local`.

> **Gain nul.** 53 526 345 → 53 526 263 octets, soit **−82 octets** (0,0002 %).
> Une couche de moins (21 → 20), et c'est tout. La raison : `--no-cache-dir` était
> déjà là, donc il n'y avait aucun cache pip à jeter, et ce service n'a aucune
> étape de compilation. Le multi-stage paie quand il y a des outils de build à
> laisser derrière soi ; ici il n'y en a pas. Abandonné, parce qu'un Dockerfile
> plus complexe pour 82 octets est une mauvaise affaire.

**3. `pip install --no-compile` sur `stats-api`** — ne pas pré-compiler les `.pyc`
à l'installation.

> **Gain réel, coût réel.** 165,2 → **159,4 Mo** (−5,8 Mo, −3,5 %), content size
> 53,5 → 51,6 Mo. Mais le temps jusqu'à la première réponse passe de **1,36 s à
> 1,75 s**, soit **+29 %** : sans `.pyc` sur disque et avec
> `PYTHONDONTWRITEBYTECODE=1` qui empêche de les écrire au premier import, Python
> recompile les sources **à chaque démarrage du conteneur**.
>
> **Rejetée.** Le TP pose comme critère de validation que « le temps de démarrage
> n'a pas régressé par rapport à la mesure précédente ». Celle-ci le fait franchir
> de 29 % pour économiser 5,8 Mo, alors que la cible de 180 Mo était déjà tenue
> avec 15 Mo de marge. Payer une régression de démarrage pour un objectif déjà
> atteint n'a pas de sens. Elle redeviendrait intéressante le jour où la
> contrainte serait la taille — un registry facturé au Go, ou des pulls très
> fréquents sur une liaison lente.

Bilan : les deux Dockerfiles sont restés tels quels. Trois tentatives, aucune
retenue, mais chacune chiffrée — c'est la différence entre « j'ai optimisé » et
« j'ai mesuré ».

### Le coût du build à froid dans une pipeline

Une pipeline qui construit ces deux images 50 fois par jour :

| | Par build | × 50 / jour |
| --- | --- | --- |
| À froid (`--no-cache`) | 14,97 s | **12 min 29 s** |
| À chaud (cache chaud) | 1,48 s | **1 min 14 s** |

**11 min 15 s de calcul économisées par jour**, uniquement grâce à l'ordre des
instructions du Dockerfile — les manifestes copiés avant le code source. Sur un
mois de jours ouvrés, environ 4 heures. C'est ce qui transforme le cache de build
d'un détail de confort en sujet d'optimisation sérieux.

### Jusqu'où compresser avant que l'image devienne indébuggable ?

Le compromis a été tranché à **« l'image garde un shell »**. Les images
distroless descendraient plus bas et réduiraient la surface d'attaque, mais elles
n'embarquent pas `sh`. Or trois des cinq vérifications du chapitre 5 passent
par un shell dans le conteneur — `docker run --rm mon-image sh -c whoami`,
`ls -a`, `ls node_modules | grep -c jest` — et le diagnostic du chapitre 6 s'est
fait avec `docker exec`. Une image sans shell aurait rendu la moitié de cette
journée impossible à instrumenter. Sur un service en production, avec du
monitoring externe et des logs centralisés, l'arbitrage pencherait dans l'autre
sens.

### Le test qui rejoue toute la journée

Dossier neuf, `docker-compose.prod.yml` et un `.env` **reconstruit à partir de
`.env.example`**, images tirées du registry, aucun code source.

| Étape | Attendu | Obtenu |
| --- | --- | --- |
| Démarrage | 4 services up | `db (healthy)`, `todo-api (healthy)`, `stats-api`, `adminer` |
| `POST` sans champ obligatoire | refusé proprement | `400 {"error":"description est obligatoire"}`, `/health` toujours 200 |
| `5432` depuis l'hôte | injoignable | `docker compose port db` → aucun port publié |
| `/stats` vs `COUNT` manuel | identiques | `{"todo":3,"in_progress":0,"done":1}` vs `{"todo":3,"done":1}` en SQL |
| `db` tué en pleine charge | dégradation propre | `todo-api` → 503 en 3,00 s · `stats-api` → 503 en 0,005 s · les deux `/health` à 200 · reprise automatique après `start` |

Une seule ligne mérite un mot : `/stats` renvoie `in_progress: 0` là où le
`COUNT` SQL n'a **aucune ligne** pour cet état. Ce n'est pas un écart, c'est le
`KNOWN_STATUSES` du code Python qui pré-remplit les trois compteurs à zéro. Un
client peut donc toujours lire `.in_progress` sans tester son existence — ce qui
est précisément l'intérêt de cette liste en dur.

---

# Jour 2 — matin : diagnostiquer avant d'automatiser

## Échauffement — quatre fichiers cassés, quatre diagnostics

Les fichiers sont dans [`exercices/j2-echauffement/`](exercices/j2-echauffement/),
avec un corrigé à côté de chacun. Ce sont des supports d'exercice : rien là-dedans
n'est branché sur l'application.

### Fichier 1 — l'erreur subtile

**Symptôme.** Le build passe. Il ne sort qu'un avertissement, facile à ignorer :
`JSONArgsRecommended: JSON arguments recommended for CMD to prevent unintended
behavior related to OS signals (line 7)`.

**Cause A — le lock file manque au `COPY` de la ligne 3.** `npm install` sans
`package-lock.json` re-résout tout l'arbre. Comparaison de l'arbre installé dans
l'image avec le lock du dépôt : **84 paquets installés, 2 divergent** —
`encodeurl` 1.0.2 → 2.0.0 et `ms` 2.1.3 → 2.0.0. Deux effets en cascade, et le
second est le plus vicieux : le `COPY . .` de la ligne 5 remet ensuite le lock
dans l'image, qui contient donc un `package-lock.json` **qui ne décrit pas son
propre `node_modules`**. Et comme la couche d'install n'est indexée que sur
`package.json`, modifier le lock ne la réinvalide même pas.

**Cause B — `CMD npm start`, en forme shell.** Dans le conteneur :

```
PID   COMMAND
    1 npm start
   18 node src/server.js
```

npm est PID 1, l'application est son enfant. Mesuré contre le même conteneur
lancé en forme exec :

| | `CMD npm start` | forme exec |
| --- | --- | --- |
| Mémoire | **42,36 Mio** | 23,38 Mio |
| PIDs | 22 | 11 |
| `docker stop` | 0,15 s | 0,17 s |
| Code de sortie quand l'app est tuée par `SIGKILL` | **1** | **137** |

Deux surprises. D'abord, l'arrêt est propre : npm 10.8.2 relaie bien le SIGTERM,
la panne classique des « 10 secondes puis SIGKILL » ne s'est pas produite — elle
suppose un `sh` qui reste en PID 1 sans relayer, ce qui arrive avec un CMD shell
plus complexe qu'un simple `npm start`. Ensuite, ce qui casse vraiment est
ailleurs : **npm écrase le code de sortie**. L'app tuée par SIGKILL fait sortir le
conteneur en 1 au lieu de 137. Un orchestrateur qui distingue « crash applicatif »
de « tué par le OOM killer » se trompe de diagnostic, et 19 Mio partent en fumée
au passage pour un process qui ne sert plus à rien une fois l'app démarrée.

**Correction.** `COPY package.json package-lock.json ./` + `npm ci --omit=dev`,
et `CMD ["node", "src/server.js"]` (`Dockerfile.1.corrige`).

### Fichier 2 — l'ordre compte

Protocole : `docker builder prune -af`, build, rebuild sans rien toucher, puis
ajout d'une ligne dans `src/app.js` et rebuild.

| Build | Fichier d'origine | Fichier corrigé |
| --- | --- | --- |
| À froid | 4,59 s | 4,32 s |
| Sans rien modifier | 0,65 s | — |
| **Après modification de `src/app.js`** | **3,58 s** | **0,74 s** |

**Cause.** `COPY . .` est en ligne 3, avant `RUN npm install`. Une virgule dans
`src/app.js` change la couche `COPY`, donc invalide tout ce qui suit, donc
réinstalle 84 paquets qui n'ont pas bougé. Le corrigé ne change **que l'ordre** :
manifestes d'abord, `npm ci`, code source ensuite. Le rebuild tombe à 0,74 s, soit
**4,8× plus rapide, −2,83 s par build**. Sur les 50 builds quotidiens du scénario
du chapitre 10, c'est 2 min 21 s de machine par jour, sur ce seul fichier.

**Défaut bonus.** Le TP annonce « celui-ci fonctionne ». Pas sur ce projet :
`CMD ["node", "server.js"]` donne `Error: Cannot find module '/app/server.js'`,
le point d'entrée étant `src/server.js`. Le fichier build bien, mais l'image ne
démarre pas.

### Fichier 3 — l'image géante

**Symptôme d'abord, avant même la taille : le build échoue.**
`npm error Missing script: "build"` — ce projet n'a pas de script `build`, et
`RUN npm run build` sort en 1. `Dockerfile.3.mesurable` retire cette seule ligne
pour rendre la taille mesurable : **1,58 Go sur disque, 397 Mo de contenu**.

Trois raisons distinctes à ce poids, chacune avec sa technique de J1 :

| # | Raison | Mesure | Technique J1 |
| --- | --- | --- | --- |
| 1 | Image de base `node:18` (Debian bookworm) | **1,58 Go à elle seule**, contre 192 Mo pour `node:18-alpine` | image de base minimale, tag épinglé |
| 2 | `npm install` laisse son cache dans l'image | `/root/.npm` = 3,6 Mo embarqués ; couche d'install = 9,57 Mo | `npm ci --omit=dev && npm cache clean --force`, ou multi-stage |
| 3 | `COPY . .` embarque tout le contexte | l'image contient `scripts/`, `exercices/`, `package-lock.json`, `.env.example` | `.dockerignore` + `COPY` ciblé |

La raison 1 écrase les deux autres : **99 % du poids ne vient pas du projet**,
il vient du choix de la première ligne. Le corrigé (`Dockerfile.3.corrige`,
alpine + multi-stage + `npm ci --omit=dev`) tombe à **188 Mo, soit −88 %**.

**Le test qui fait le plus peur.** Pour chiffrer la raison 3, j'ai rebuildé le
même fichier après avoir retiré temporairement le `.dockerignore` : la couche
`COPY` passe de 143 ko à **7,14 Mo**, et surtout `/app/.env` **atterrit dans
l'image**, 352 octets, `DB_PASSWORD` lisible par qui tire l'image. La taille
n'était pas le vrai problème de ce fichier.

### Fichier 4 — le compose qui ne se parle pas

**Défaut 1, à la lecture.** `docker compose config` refuse le fichier :

```
validating docker-compose-broken.yml: volumes must be a mapping
```

`db-data` est écrit sans deux-points sous `volumes:` : YAML lit une chaîne là où
Compose attend une clé. Aucun conteneur ne démarre, et l'erreur ne parle pas de
la ligne fautive — il faut savoir que « mapping » veut dire « il manque un `:` ».

**Défaut 2, à l'exécution.** Le deux-points ajouté, la stack démarre, et
l'application n'atteint jamais sa base. `DB_HOST: postgres` alors que le service
s'appelle `database` : sur un réseau Docker, le nom DNS **est** le nom du service.

```
database          -> 172.19.0.2
postgres          -> ERREUR EAI_AGAIN
```

Bout en bout, avec l'image de la Todo API branchée sur ce réseau :

| `DB_HOST` | `/health` | `/api/tasks` | Logs |
| --- | --- | --- | --- |
| `postgres` | 200 | **503** `{"error":"base de donnees injoignable, reessayez plus tard"}` | `Connection terminated due to connection timeout` |
| `database` | 200 | **200** `[]` | — |

Détail qui explique le message : le résolveur embarqué de Docker (127.0.0.11)
ne répond pas « inconnu » pour `postgres`, il transmet la question en amont et
attend. D'où un `EAI_AGAIN` puis un *timeout* côté driver, et non un `ENOTFOUND`
franc. Un nom de service faux coûte donc plusieurs secondes par tentative avant
de se voir.

**Défaut 3, invisible à l'exécution.** `version: '3.8'` en tête :
`the attribute 'version' is obsolete, it will be ignored`. Retirée dans le
corrigé.

**Défaut 4, celui du tableau d'erreurs du TP.** `depends_on` en liste courte
n'attend que le *démarrage du conteneur* Postgres, pas sa disponibilité : c'est
la fabrique à `connection refused` au premier boot. Le corrigé passe en
`condition: service_healthy` avec un `pg_isready`.

### Bonus non prévu : un vrai `port already allocated`

En lançant la stack, Docker a refusé le port 3000, puis le 3001 :

```
failed to bind host port 0.0.0.0:3000/tcp: address already in use
```

`docker ps` ne montrait **rien** sur 3000. Normal : le coupable n'était pas un
conteneur mais un process de l'hôte, `node /var/www/lpa/backend/src/app.js`
(PID 347951), trouvé avec `ss -ltnp`. Leçon retenue pour cet après-midi : quand
un port est pris, `docker ps` n'est qu'une moitié de réponse, `ss` ou `lsof` est
l'autre. La stack est repartie sur 3456.

## Le cas qui piège tout le monde : `EXPOSE` contre `ports`

Vérifié sur nos propres images plutôt que sur parole.

**`EXPOSE` ne publie rien.** L'image `todo-api` déclare
`ExposedPorts: {"3000/tcp":{}}`. Lancée sans `-p`, le conteneur affiche
`Ports: {"3000/tcp": null}` : aucune publication.

**Mais attention à la conclusion trop rapide sur un hôte Linux.** Sans le moindre
`-p`, `curl http://172.17.0.3:3000/health` depuis la machine répond **200**.
Ce n'est pas `EXPOSE` qui fait ça : l'hôte route directement vers le réseau
bridge. Une autre machine du réseau, elle, n'y arrive pas. « Non publié » veut
dire « pas de mapping sur l'hôte », pas « inatteignable depuis l'hôte ».

**Sur la vraie stack.** `db` n'a pas de `ports:` :

| Vérification | Résultat |
| --- | --- |
| `docker compose ps` → colonne Publishers de `db` | `[{ 5432 0 tcp}]` — port hôte 0, donc aucun |
| `docker compose port db 5432` | `invalid IP:0` |
| `todo-api` → `db:5432` (`SELECT count(*) FROM tasks`) | **4 tâches** |

La base est donc joignable par l'API et par personne d'autre, ce qui est
exactement l'intention du chapitre 6.

**Le piège de mesure, rencontré pour de bon.** Un test TCP direct sur
`127.0.0.1:5432` depuis l'hôte répond « ouvert » — de quoi croire que la base du compose fuit.
Elle ne fuit pas : c'est un **PostgreSQL 16 installé sur la machine** (PID 82631,
`127.0.0.1:5432`) qui répond, comme le port 3000 était tenu par une application
hors Docker. Avant de conclure qu'un conteneur expose quelque chose, vérifier
**qui** écoute, pas seulement **que** ça écoute.

Les trois réflexes du chapitre, dont deux étaient déjà en place ici : rien n'est
publié par défaut (`db` n'a jamais eu de `ports:`), on publie sur `127.0.0.1`
quand c'est pour débugger (le registry local du chapitre 9 est en
`127.0.0.1:5000`), et le port de dev n'est pas celui de prod (`API_PORT` vient du
`.env`).

## Ce que le reste du matin change pour ce repo

Le reste de la matinée est du cours — DevOps et CALMS, l'histoire des outils, les
principes de la CI, l'anatomie d'une pipeline, trois pipelines décortiquées,
DevSecOps, K3S. Quatre points s'appliquent directement à ce dépôt, et deux
pointent un manque :

- **Le budget de dix minutes est déjà tenable.** Les mesures du chapitre 10
  donnent 1,00 s et 0,48 s de build à chaud pour les deux images : le stage
  `build` d'une future pipeline ne sera pas le problème. C'est l'inverse qui est
  vrai — le cache de layers et le poids de l'image, traités hier comme de
  l'esthétique, sont en fait des lignes du budget de temps de la CI.
- **Un artefact construit une fois, promu ensuite.** Le chapitre 9 tague à la
  main en `1.0.0`. La règle du jour dit : taguer par `sha` de commit, et promouvoir
  la **même** image de staging vers la prod. À corriger quand la pipeline arrivera.
- **`npm test` n'existe pas.** Le `package.json` n'a que `start` et `dev`, et
  `tests/` est vide. Une pipeline branchée aujourd'hui n'aurait littéralement rien
  à exécuter au stage `test` : c'est le trou n°1 avant d'automatiser quoi que ce
  soit.
- **Le DevSecOps commence par une ligne.** `npm audit --audit-level=high` en job,
  et `gitleaks` qui relit **tout l'historique** — d'où l'importance du `.env`
  jamais commité, dont la démonstration involontaire est plus haut : il suffit de
  perdre le `.dockerignore` pour le retrouver dans une couche d'image.

---

# Jour 2 — après-midi : première pipeline verte (ClickFast)

L'après-midi ne se fait pas sur la Todo API — le TP l'écarte explicitement,
« trop de pièces mobiles : base de données, secrets ». Le support est **ClickFast**,
un jeu de clics statique, dans son propre dépôt :
[GabrielSaint-Louis/tp-devops-clickfast](https://github.com/GabrielSaint-Louis/tp-devops-clickfast)
· site publié : <https://gabrielsaint-louis.github.io/tp-devops-clickfast/>

La pipeline : `test` → `build` → `deploy`, trois jobs enchaînés par `needs:`,
déploiement Pages conditionné à `main`. Ce qu'elle a réellement produit :

| Exécution | `test` | `build` | `deploy` | Durée |
| --- | --- | --- | --- | --- |
| Premier push | — | — | — | **0 s, zéro job** |
| Après correction | ✅ | ✅ | ✅ | 48 s |
| Régression volontaire (PR) | ❌ | skipped | skipped | 25 s |

Trois choses à retenir ici, parce qu'elles retomberont sur la pipeline de cette
API demain :

- **Le premier rouge n'était pas un test cassé, c'était le YAML.** Zéro job, zéro
  log, rouge instantané : `docker images --format 'Image : {{.Size}}'` contient un
  `: ` que YAML lit comme un séparateur de clé, et le workflow entier est refusé
  avant démarrage. Un `yaml.safe_load` en local avant de pousser aurait coûté deux
  secondes.
- **Le vert ne veut rien dire tant qu'on n'a pas vu la pipeline bloquer.** Une
  branche où un clic vaut 2 points au lieu de 1 fait rougir `test` et laisse
  `build` et `deploy` en *skipped* : aucune image construite, rien publié.
- **Les tests aussi se testent.** Cinq tests Jest passaient encore après avoir
  retiré le garde-fou « le temps est écoulé » du code : c'est l'attribut
  `disabled` qui masquait le trou, pas la logique qui était vérifiée. Un sixième
  test envoie l'événement avec `dispatchEvent()` pour contourner `disabled`, et
  rougit correctement. Le même piège attend la Todo API : un test qui ne peut pas
  échouer est un stage vert qui ne prouve rien.

Ce dernier point rejoint directement le trou noté ce matin : `npm test` n'existe
toujours pas ici, et c'est la première chose à écrire avant de brancher une
pipeline sur cette API.

---

# Jour 3 — déploiement automatisé, surveillance, astreinte

La veille au soir, l'image était parfaite et personne ne pouvait s'en servir :
elle dormait sur un registry. Et la pipeline qui la construisait vivait sur
ClickFast, pas ici. Deux trous, refermés dans cet ordre.

## Phases 1 à 4 — la pipeline atteint une machine de production

**La pipeline déménage.** Cinq jobs sur `.github/workflows/ci.yml`. `lint`,
`test` et `test-integration` en parallèle, `build` derrière les trois, `deploy`
derrière `build`. La règle de déclenchement sépare les deux usages : une pull
request vérifie et construit sans rien publier, un push sur `main` publie
l'image taguée au sha et la déploie.

Registry : **GHCR** et pas Docker Hub. Le `GITHUB_TOKEN` du run suffit à
s'authentifier, donc aucun mot de passe de registry à stocker en secret, et le
jeton meurt avec le job. Ça referme au passage le premier point resté ouvert le
J2 (le scope `write:packages` manquant sur le token `gh`) : la pipeline n'en a
pas besoin, elle a le sien.

**La machine cible.** Un conteneur `docker:28-dind` avec un `sshd`. Les trois
vérifications demandées :

| Vérification | Résultat |
| --- | --- |
| Connexion par clé, puis `docker run --rm hello-world` dedans | `Hello from Docker!` |
| La même connexion **sans** `-i deploy_key` | `Permission denied (publickey)`, code 255 |
| `docker restart vm-prod` puis reconnexion | `hello-world` toujours présent, grâce au volume |

Et l'isolation, en une ligne : `docker ps` **dans** la cible affiche zéro
conteneur, quand l'hôte en affiche six. Une panne en « production » ne touche
pas l'environnement de travail — ce qui n'est pas théorique ici, ce serveur
héberge un vrai site en pm2.

Deux écarts assumés par rapport au TP, tous deux dictés par cette machine :

- **Ports décalés côté hôte** : 2222, 13000, 19090, 13001 au lieu de 2222, 3000,
  9090, 3001. Les ports 3000 et 3001 appartiennent déjà au site en production.
  À l'intérieur de la machine cible, rien ne change.
- **Publication sur `127.0.0.1`** et pas `0.0.0.0`. Ce serveur est exposé sur
  Internet ; un `sshd` root et un Grafana n'ont pas à l'être. On y accède par
  tunnel SSH.

**Le runner self-hosted.** Le même job, écrit deux fois, et un seul mot qui
change :

| `runs-on` | `hostname` | Conteneurs visibles | Machine cible joignable |
| --- | --- | --- | --- |
| `self-hosted` | `ubuntu` | les 6 de ce serveur | oui, port 2222 ouvert |
| `ubuntu-latest` | `runnervmvrwv9` | aucun | non, « et c'est normal » |

Le garde-fou de sécurité est vérifié plutôt qu'affirmé : sur la branche de
travail, le job `Deploiement` est sorti **`skipped`**. Ce dépôt est public,
un runner self-hosted exécute sur une vraie machine ce que la pipeline lui dit
d'exécuter, et `if: github.ref == 'refs/heads/main'` est la ligne qui sépare
« ma machine exécute ce que j'ai fusionné moi-même » de « ma machine exécute ce
que n'importe qui a proposé ».

**Le premier déploiement automatique** est passé du premier coup :
`L'API repond apres 2 tentative(s)`, puis
`{"status":"ok","timestamp":"2026-08-05T12:52:01.320Z"}`. Sans qu'une seule
commande ait été tapée à la main.

## Phase 5 — rejouer, et revenir en arrière

**Idempotence.** Le même déploiement rejoué sur le même code :

| | Avant | Après |
| --- | --- | --- |
| ID du conteneur `todo-api` | `4296efc22db7…` | `4296efc22db7…` |
| `StartedAt` | `12:51:59.050Z` | `12:51:59.050Z` |
| Conteneurs | `todo-api`, `todo-db` | `todo-api`, `todo-db` |
| Tâches en base | 1 | 1 |

Pas seulement « ça remarche » : le conteneur n'a même pas été redémarré.
`docker compose up -d` a comparé l'état voulu à l'état réel et n'a rien touché.
Aucun orphelin, aucun `port already allocated` — celui-là même qui avait été
rencontré au J2 avec une séquence de `docker run`.

**Le retour arrière, chronomètre en main.** Une régression volontaire (le champ
`status` retiré de la réponse) a été fusionnée sur `main`. Elle a franchi le
linter et les 22 tests unitaires sans en réveiller un seul, et la pipeline l'a
déployée sans broncher.

| Moment | Heure (UTC) |
| --- | --- |
| Constat — le champ `status` a disparu de `/api/tasks` | 12:56:32 |
| Service rétabli sur la version précédente | 12:56:34 |
| **Durée constat → rétablissement** | **2 secondes** |

Deux secondes, parce qu'il n'y a eu ni build, ni pipeline, ni conjecture :
l'image d'avant était déjà sur le registry, taguée au sha de son commit. Il a
suffi de la nommer. La bonne nouvelle du J2 (« un tag au sha ») a payé son
premier dividende ici.

Le troisième scénario, l'échec propre :

| Commande | Sortie | État de la production |
| --- | --- | --- |
| `apply.sh 000000…` (tag inexistant) | `Error manifest unknown`, code 1 | **intacte**, l'ancienne version tourne |
| `docker compose up -d` sans `TAG` | `required variable TAG is missing a value`, code 1 | intacte |

**Ce que la phase a révélé et qui n'était pas prévu :** le garde `${TAG:?}` du
`compose.yml` casse aussi toutes les commandes de *lecture* — `docker compose
ps`, `docker compose logs` — celles qu'on tape justement pendant une panne. Une
procédure d'astreinte bâtie dessus aurait laissé son lecteur devant un message
d'erreur au premier diagnostic. D'où `apply.sh`, qui écrit le sha dans le
`.env` de la machine : il devient l'état courant, lisible ensuite par toutes
les commandes, et déployer devient le même geste que revenir en arrière.

## Phase 6 — les tests qui touchent la base

La régression du champ `status` est passée devant 22 tests unitaires et le
linter. Aucun d'eux ne regardait la forme réelle d'une réponse.

La suite d'intégration a été écrite **avant** de corriger le code, et lancée
contre lui :

```
✕ creer une tache, puis la relire par son id, et retrouver ce qui a ete envoye
✕ une tache creee sans status prend la valeur par defaut todo
✕ modifier une tache change updatedAt et laisse createdAt tranquille
✓ … 9 autres

Tests: 3 failed, 9 passed, 12 total
```

Une ligne corrigée dans `toTask()` : **12 verts sur 12**. C'est la seule parade
fiable au test décoratif — casser le code exprès et vérifier que la suite
devient rouge.

Ce qui fait la différence dans ces tests : la relecture compare l'objet
**entier**, pas champ par champ. Un `expect(body.description).toBe(...)` reste
vert quand un autre champ disparaît.

En pipeline, le job tourne sur `ubuntu-latest` avec un PostgreSQL jetable en
`services:`, un `--health-cmd pg_isready` pour ne pas démarrer pendant l'initdb,
et `npm run migrate` avant les tests. La migration importe le `SCHEMA` de
`src/db.js` au lieu d'en garder une copie : c'est exactement la divergence
base de test / base de prod qui produit les histoires du vendredi 17 h 32.

## Phases 7 et 8 — mesurer, et regarder

Quatre mesures exposées sur `/metrics`, en texte brut :

```
http_requests_total{method="GET",route="/api/tasks",status="200"} 12
http_requests_total{method="POST",route="/api/tasks",status="201"} 3
http_requests_total{method="GET",route="/api/tasks/:id",status="404"} 1
todo_tasks_created_total 3
todo_tasks_in_database{status="todo"} 6
todo_tasks_in_database{status="in_progress"} 0
todo_tasks_in_database{status="done"} 0
```

Les deux pièges annoncés par le TP sont évités **et testés** : un 404 sur route
inconnue est compté, mais sous le label fixe `(inconnue)` et jamais sous l'URL
demandée ; l'identifiant d'une tâche n'apparaît nulle part, c'est
`/api/tasks/:id` qui sert de label.

Un troisième piège, non annoncé, a été trouvé par le test : la racine d'un
routeur Express produit `/api/tasks/` avec une barre finale que
`/api/tasks/:id` n'a pas. Deux écritures pour deux routes voisines, c'est un
tableau de bord où l'on hésite à chaque panneau.

Les buckets de l'histogramme descendent à 5 ms et pas 50 : cette API répond en
quelques millisecondes, et avec les tranches d'un exemple générique tout
tomberait dans le premier seau — le p95 répondrait « moins de 50 ms » sans
jamais rien distinguer.

### Le tableau de relevés

Prometheus scrape toutes les 5 s. `up` bascule à 0 en **4 secondes** après un
`docker stop todo-api`, bien en deçà des 15 s demandées.

| Moment | `up` | Requêtes/s | Taux d'erreur | p95 |
| --- | --- | --- | --- | --- |
| Au repos, avant la boucle de charge | 1 | 0,036 | 0,000 % | 5 ms |
| Pendant la boucle de charge | 1 | 12,473 | 0,000 % | 5 ms |
| Pendant l'incident — **base coupée** | **1** | 12,600 | **65,483 %** | 5 ms |
| Pendant l'incident — **API arrêtée** | **0** | — | — | — |

Le 0,036 req/s au repos n'est pas du bruit : c'est le `HEALTHCHECK` du
Dockerfile, toutes les 30 secondes. 1/30 = 0,033.

**Les deux dernières lignes sont le vrai résultat de la journée.** Couper la
base et couper l'API donnent deux signatures que rien ne confond :

- **base coupée** → la cible répond toujours (`up` = 1), mais 65 % des réponses
  sont des **503**, et les créations (201) tombent à zéro ;
- **API arrêtée** → `up` = 0, et plus aucune donnée du tout.

Cette distinction tient à un choix d'implémentation qui ne se voit pas dans le
code : `/metrics` **avale** l'erreur de sa jauge métier quand la base est
absente. Si elle remontait, la page répondrait 500, Prometheus n'obtiendrait
plus rien, `up` passerait à 0 — et une base tombée serait indiscernable d'une
API morte.

## Phase 10 — l'astreinte

Le TP fait jouer cette phase en binôme, un pilote qui diagnostique et des mains
qui exécutent. **Fait seul ici**, les deux rôles tenus par la même personne :
c'est l'écart le plus important du rendu, et il enlève au test sa partie la plus
sévère — la procédure n'a pas été confrontée à quelqu'un qui ne l'avait pas
écrite. Ce qui reste vérifiable l'a été : le tirage de la panne, lui, est
réellement aléatoire, et la réparation s'est faite en suivant le document.

### Entrée « mains » — ce que j'ai appris de mon propre système

Deux incidents tirés au sort, chronomètre en main :

| | Panne tirée | Diagnostic | Temps constat → rétablissement |
| --- | --- | --- | --- |
| 1ᵉʳ | n° 1, `docker stop todo-api` | juste | **38 s** |
| 2ᵉ | n° 2, `docker stop todo-db` | juste | **17 s** |

Le temps divisé par deux ne mesure pas une progression personnelle. Il mesure
ce que valent les quatre corrections apportées à la procédure entre les deux.

### Entrée « pilote » — ce qui m'a manqué

Quatre choses, dans l'ordre où elles ont coûté du temps.

1. **Trois pannes différentes donnent `up = 0`.** Mon tableau des signatures
   disait « `todo-api` absent » pour l'API arrêtée et « `Exited` ou
   `Restarting` » pour l'API relancée sans configuration — sauf que les deux
   laissent un conteneur `Exited`. Le critère qui tranche vraiment est le
   **code de sortie** : `Exited (0)` = arrêt propre, `Exited (1)` = plantage au
   démarrage. Corrigé.
2. **Les logs se lisent par la fin.** Huit lignes `ENOTFOUND todo-db`, restes
   d'un incident antérieur, précédaient le `SIGTERM recu` qui, lui, disait la
   vérité. Sans regarder l'ordre, on part réparer la base alors que c'est l'API
   qu'on a arrêtée.
3. **Le panneau *Trafic* ne dit pas « plus personne n'appelle ».** Au premier
   incident, mon générateur de charge est mort avec la cible (`set -e`, un
   `curl` en échec, exit 56). Le trafic tombait à zéro pour deux raisons
   mélangées. Corrigé : il survit désormais à sa cible, comme de vrais
   utilisateurs qui, eux, continuent d'appeler.
4. **Et la plus utile : ne pas ouvrir Grafana en premier.** Les panneaux
   *Trafic*, *Erreurs* et *Latence* reposent sur `rate(...[1m])` : ils ont
   besoin d'une minute avant de refléter quoi que ce soit. Au second incident,
   cinq secondes après l'arrêt de la base, le panneau *Erreurs* affichait
   encore **0,000 %** en toute bonne foi — pendant que `docker ps -a` montrait
   déjà `todo-db  Exited (0) 5 seconds ago`.

**Quel panneau a été le plus utile, lequel n'a rien apporté ?** *Disponibilité*
a tout porté : c'est le seul immédiat, parce qu'il ne calcule aucun taux.
*Latence p95* n'a rien apporté sur ces deux pannes — il n'aurait servi que sur
la panne n° 5, la machine saturée. *Codes de statut* aurait fait la différence
sur la base coupée si j'avais attendu une minute : les 503 y sont sans
ambiguïté.

**Qu'est-ce qu'un tableau de bord aurait fait gagner, en minutes ?** Sur ces
deux pannes-là, franchement : rien. `docker ps -a` répond plus vite. Le tableau
de bord sert à **savoir qu'il y a un problème** quand personne ne regarde, et à
mesurer combien de temps il a duré — pas à identifier lequel dans les trente
premières secondes. C'est la conclusion la moins attendue de la journée, et
elle est écrite en haut du § 6 de la procédure.

## Après coup — les vérifications qui manquaient

En relisant le rendu contre la grille d'évaluation, trois choses étaient
affirmées sans preuve. Elles ont été jouées pour de vrai.

### Les cinq signatures de panne sont maintenant mesurées

Le tirage au sort de la phase 10 n'avait donné que les pannes 1 et 2 : les trois
autres lignes du tableau de la procédure étaient raisonnées. Déclenchées
délibérément, elles ont donné ceci — **une des trois était fausse.**

| Panne | Ce qui était écrit | Ce qui a été observé |
| --- | --- | --- |
| 3 — réseau coupé | `up=0`, conteneur `Up` | ✅ exact, **plus** deux détails manquants : le conteneur se déclare `Up (healthy)`, et ses logs ne contiennent **aucune erreur** |
| 4 — sans configuration | `up=0`, `Exited (1)` | ✅ exact, mais le message utile est en **ligne 5 sur 17** — `--tail 10` ne l'affiche pas |
| 5 — machine saturée | « le p95 explose, `up` clignote, timeouts » | ❌ **faux.** `up` reste à 1, 0 % d'erreur. Seul le débit bouge : 21,6 → 14,6 req/s (−32 %), p95 40 → 48 ms |

La panne 5 est la plus instructive du lot : c'est la seule qui n'allume aucun
voyant. Elle ne se voit qu'en comparant au tableau de relevés ci-dessus — sans
valeur de référence, 14,6 req/s ne veut rien dire.

Celle du réseau coupé est la plus déroutante : Docker affiche `healthy` parce
que le `HEALTHCHECK` interroge `127.0.0.1` depuis l'intérieur du conteneur, et
réussit toujours — pendant que plus personne au monde ne peut joindre
l'application.

### Les trois chemins d'échec de la pipeline, éprouvés en cassant `main`

Trois commits volontairement fautifs, poussés sur `main` puis révertés.

| Scénario | Résultat | Production |
| --- | --- | --- |
| Secret `DEPLOY_PORT` mal orthographié | seul `Deploiement` rouge ; clé privée absente du log, **8 secrets masqués** | intacte |
| `/health` pointé sur un port mort | job rouge avec `::error::`, `compose ps` et logs affichés | **nouvelle version déjà en place** |
| Identifiant de registry retiré | seul `Image Docker` rouge, `Deploiement` `skipped` | intacte |

Deux enseignements, tous deux corrigés dans le dépôt :

1. **Un secret mal orthographié ne provoque aucune erreur côté GitHub** : il
   devient silencieusement une chaîne vide. Le job échouait bien, mais sur
   `scp: bad port "-r"` — un message qui envoie chercher une faute de syntaxe
   dans la commande alors que le problème est un nom mal écrit trente lignes
   plus haut. Quatre lignes en tête du job disent maintenant lequel manque.
2. **Un `Deploiement` rouge ne veut pas dire « rien n'a été déployé ».** Quand
   c'est l'étape de vérification qui échoue, la nouvelle version tourne déjà.
   Supposer l'inverse ferait revenir en arrière depuis une version qui n'est pas
   celle qu'on croit.

### Deux bonus

- **Retour arrière depuis la pipeline** (`.github/workflows/rollback.yml`) : un
  sha, une raison, et c'est le même `apply.sh` au bout. Plus besoin de la clé
  privée ni du dépôt, et le geste laisse une trace horodatée — ce qu'un `ssh`
  dans un terminal ne laisse nulle part.
- **Deux alertes Grafana**, chaque seuil justifié par une mesure plutôt que par
  une intuition :

| Alerte | Seuil | Pourquoi ce seuil |
| --- | --- | --- |
| API injoignable | `up = 0` pendant **1 min** | `up` bascule en 4 s, on pourrait alerter en 10 — mais un déploiement normal coupe 2 à 10 s, et une alerte qui sonne à chaque mise en production n'est plus lue au bout de trois jours |
| Erreurs serveur | **> 5 % pendant 5 min** | c'est exactement le critère de retour arrière du § 4 de la procédure. Repères mesurés : 0,000 % en marche normale, 65 % base coupée — il n'y a rien entre les deux |

Testées : `docker stop todo-api` → alerte `firing` en **70 secondes**, pendant
que celle du taux d'erreur restait `inactive`. Les deux ne se déclenchent pas
sur le même événement.

### Ce que la panne du runner a appris

Entre deux scénarios, le job `Deploiement` est resté **11 minutes en `Queued`**
alors que l'API GitHub affichait `status=online busy=false` et que le process
tournait. Le § 7 de la procédure prévoyait le cas « runner arrêté » ; il ne
prévoyait pas « runner qui se croit vivant ». Un redémarrage l'a débloqué.

C'est aussi la démonstration que le `nohup` est une solution provisoire :
`svc.sh install` reste la vraie réponse.

---

## Ce qui reste ouvert

### Refermé au jour 3

- ~~**Les images ne sont publiées que sur un registry privé local**, faute du
  scope `write:packages` sur le token `gh`.~~ La pipeline n'a pas besoin de ce
  token : le `GITHUB_TOKEN` du run publie sur GHCR et expire avec le job.
- ~~**`tests/` est vide et `npm test` n'existe pas.**~~ 43 tests : 22 unitaires,
  21 d'intégration contre un vrai PostgreSQL. Et la preuve qu'ils ne sont pas
  décoratifs — cassés exprès, ils rougissent.
- ~~**Le tag des images est encore manuel.**~~ Tagué au sha du commit, par la
  pipeline, jamais deux fois le même. C'est ce qui rend le retour arrière
  trivial (2 s mesurées).

### Toujours ouvert

- **Aucune sauvegarde de la base.** Le volume `pgdata` est la seule copie des
  données. Un `docker volume rm` de trop, et rien ne les ramène. C'est le
  premier manque à combler pour un vrai service, et il est écrit noir sur blanc
  au § 7 de la procédure de déploiement.
- **Aucune limite de ressources** (`deploy.resources.limits`) sur les services
  de la stack. La panne n° 5 de l'exercice d'astreinte le montre bien : rien
  n'empêche un conteneur voisin de prendre tout le CPU de la machine.
- **Le déploiement coupe le service quelques secondes.** `docker compose up -d`
  arrête l'ancien conteneur avant de démarrer le nouveau. Un déploiement bleu-
  vert ou progressif est ce que le jour 4 doit apporter, avec Kubernetes.
- **Le runner self-hosted tourne dans un `nohup`**, pas en service système. Un
  redémarrage du serveur, et les jobs restent `Queued` indéfiniment, sans
  message d'erreur — et ça n'est pas théorique, c'est arrivé une fois dans la
  journée sans même un redémarrage. `svc.sh install` (qui demande les droits
  root) serait la vraie réponse.
- **La passation de la phase 10 a été jouée seul**, les deux rôles tenus par la
  même personne. La procédure n'a donc jamais été confrontée à quelqu'un qui ne
  l'avait pas écrite — le seul test qui la valide vraiment.

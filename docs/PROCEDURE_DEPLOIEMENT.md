# Procédure de déploiement — Todo API

**Ce document se lit à 3 h du matin, sans réfléchir.** Il n'explique pas
comment le système est construit : il dit quoi taper, dans quel ordre, et
comment savoir que ça a marché. Pour comprendre l'architecture, voir le
`README.md` ; ici, on répare.

Toute commande de ce document se colle telle quelle dans un terminal. Si vous
devez deviner un chemin, un nom ou un port, c'est un défaut de cette procédure :
signalez-le, elle se corrige dans le même commit que le changement qui l'a créé.

| | |
| --- | --- |
| **Durée normale d'un déploiement complet** | 1 min 15 pipeline comprise (mesuré : 62 à 75 s sur 4 exécutions), dont 2 à 10 s d'indisponibilité |
| **Durée normale d'un retour arrière** | moins de 30 s (mesuré : 2 s quand l'image est déjà sur la machine) |
| **Au-delà de 5 min sans que l'API réponde** | on ne cherche plus, on revient en arrière (§ 4) |

> Ces durées sont mesurées, pas estimées. Un déploiement qui dépasse 3 minutes
> a un problème : regardez lequel des 5 jobs traîne dans l'onglet *Actions*.

---

## 1. Ce qu'il faut avoir sous la main avant de commencer

Sans ces quatre éléments, n'ouvrez pas un terminal, vous perdrez du temps.

| Élément | Valeur | Où le trouver |
| --- | --- | --- |
| Machine cible | conteneur `vm-prod` sur le serveur `ubuntu` | déjà démarré ; sinon § 6.6 |
| Adresse et port SSH | `root@127.0.0.1`, port `2222` | publié sur la boucle locale du serveur uniquement |
| Clé privée | `deploy/deploy_key` dans votre copie du dépôt | **jamais dans le dépôt** ; à regénérer via § 6.6 si perdue |
| Dossier de travail sur la cible | `/srv/todo` | contient `compose.yml`, `prometheus.yml`, `apply.sh`, `.env`, `grafana/` |

Les ports publiés par la machine cible, **tous sur `127.0.0.1`** — rien n'est
joignable depuis Internet, il faut être sur le serveur ou passer par un tunnel :

| Service | URL depuis le serveur | Depuis votre poste |
| --- | --- | --- |
| API | `http://127.0.0.1:13000` | `ssh -L 13000:127.0.0.1:13000 <serveur>` |
| Prometheus | `http://127.0.0.1:19090` | `ssh -L 19090:127.0.0.1:19090 <serveur>` |
| Grafana | `http://127.0.0.1:13001` | `ssh -L 13001:127.0.0.1:13001 <serveur>` |
| SSH de la cible | port `2222` | — |

> **Pourquoi 13000 et pas 3000 ?** Le port 3000 de ce serveur appartient déjà au
> backend d'un autre site, et 3001 à son front. La machine cible les décale
> côté hôte. À l'intérieur d'elle, tout est resté aux ports du cours : l'API
> écoute sur 3000, Prometheus sur 9090, Grafana sur 3001.

Le raccourci qui évite de retaper les options SSH — toutes les commandes de ce
document l'utilisent :

```bash
cd ~/tp-devops-todo-api
alias cible='ssh -i deploy/deploy_key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@127.0.0.1'
```

**Vérification :** `cible hostname` répond par une chaîne de 12 caractères
hexadécimaux (l'identifiant du conteneur), pas par `ubuntu`. Si elle répond
`ubuntu`, vous êtes sur le serveur hôte et pas sur la machine cible : toutes
les commandes qui suivent toucheraient le mauvais Docker.

---

## 2. Déploiement normal — il n'y a rien à faire

Un `git push` sur `main` déclenche tout : lint, tests unitaires, tests
d'intégration contre une vraie base, construction de l'image, publication sur
GHCR taguée au sha du commit, puis déploiement sur la machine cible.

**Aucune commande n'est à taper.** Si vous vous connectez en SSH pour déployer,
c'est qu'il s'est passé quelque chose d'anormal — allez au § 3.

**Vérification, dans cet ordre :**

1. Onglet *Actions* du dépôt : les 5 jobs verts (`Lint`, `Tests unitaires`,
   `Tests d'integration`, `Image Docker`, `Deploiement`).
2. La dernière étape du job `Deploiement` affiche
   `L'API repond apres N tentative(s)` suivi de `{"status":"ok",...}`.
3. Depuis le serveur :

   ```bash
   curl -s http://127.0.0.1:13000/health
   ```

   **Attendu :** `{"status":"ok","timestamp":"..."}`

4. La version qui tourne est bien celle du commit :

   ```bash
   cible 'grep ^TAG= /srv/todo/.env'
   ```

   **Attendu :** `TAG=<les 40 caractères du sha du dernier commit sur main>`

Si le job `Deploiement` est rouge, il a déjà affiché `docker compose ps` et les
40 dernières lignes de log de l'API : lisez-les avant toute chose, la réponse y
est neuf fois sur dix.

---

## 3. Déploiement manuel d'une version précise

À n'utiliser que si la pipeline ne peut pas faire son travail : runner arrêté,
GitHub indisponible, ou urgence qui ne peut pas attendre 2 min 30.

**Étape 3.1 — Choisir la version.** Les versions disponibles sont les sha des
commits de `main` dont l'image a été publiée :

```bash
git log --oneline -10 main
```

**Vérification :** le sha choisi fait 40 caractères. Un sha court (7
caractères) ne fonctionnera pas, les images sont taguées avec le sha complet.

**Étape 3.2 — Appliquer.**

```bash
cible '/srv/todo/apply.sh <le-sha-complet>'
```

**Vérification :** la commande se termine par un tableau listant `todo-api`,
`todo-db`, `prometheus` et `grafana`, et la ligne `todo-api` porte le sha
demandé dans sa colonne `IMAGE`. Si elle s'arrête sur `manifest unknown`, cette
version n'a jamais été publiée : reprenez à l'étape 3.1. **Dans ce cas la
production n'a pas bougé**, l'ancienne version tourne toujours.

**Étape 3.3 — Confirmer que le service répond.**

```bash
curl -s http://127.0.0.1:13000/health && echo && curl -s http://127.0.0.1:13000/api/tasks | head -c 120
```

**Vérification :** `{"status":"ok",...}` puis une liste JSON (éventuellement
`[]`). Une réponse
`{"error":"base de donnees injoignable, reessayez plus tard"}` signifie que
l'API est là mais que la base ne répond pas : allez au § 6.2.

---

## 4. Retour arrière

**C'est la section la plus importante de ce document.** Elle se lit en panique,
donc elle tient en une commande.

### Qui décide, et sur quel critère

| Critère observable | Décision | Qui |
| --- | --- | --- |
| L'API ne répond plus depuis plus de **5 minutes** | retour arrière immédiat | la personne d'astreinte, seule, sans appeler personne |
| Le panneau *Erreurs* dépasse **5 %** pendant plus de 5 minutes | retour arrière immédiat | idem |
| Le p95 dépasse **1 seconde** pendant plus de 10 minutes | retour arrière | idem |
| Un comportement faux mais sans erreur (champ manquant, mauvaise valeur) | retour arrière si un client est impacté | idem |
| Doute | **retour arrière** | idem |

On revient en arrière *d'abord*, on comprend *ensuite*. Un retour arrière coûte
30 secondes et se rejoue ; une enquête menée pendant que le service est mort
coûte des heures. Personne n'a jamais eu de reproche pour être revenu en
arrière trop vite.

### La commande

```bash
# 1. Quelle version tourne en ce moment
cible 'grep ^TAG= /srv/todo/.env'

# 2. La version d'avant, dans l'historique de main
git log --format='%H  %s' -5 main

# 3. On y revient
cible '/srv/todo/apply.sh <sha-de-la-version-d-avant>'
```

**Vérification :** `curl -s http://127.0.0.1:13000/health` répond
`{"status":"ok",...}`, et le comportement fautif a disparu. Notez l'heure : le
temps écoulé entre le constat et cette réponse est la seule mesure qui compte.

> Aucune reconstruction, aucune pipeline, aucune conjecture. L'image de la
> version précédente est déjà sur le registry, taguée au sha de son commit : il
> suffit de la nommer. Mesuré le 5 août 2026 : **2 secondes** quand l'image est
> déjà présente sur la machine, moins de 30 avec le téléchargement.

### Après le retour arrière

1. Le commit fautif reste sur `main` et **sera redéployé au prochain push**.
   Corrigez-le ou révoquez-le tout de suite (`git revert <sha>`), sinon la
   panne revient toute seule.
2. Notez dans le Journal de bord du `README.md` : l'heure du constat, l'heure
   du rétablissement, ce que le tableau de bord montrait.

---

## 5. Le tableau de bord, et comment le lire

Grafana : `http://127.0.0.1:13001` — identifiant `admin`, mot de passe dans
`/srv/todo/.env` (`cible 'grep GRAFANA /srv/todo/.env'`). Tableau de bord
*Todo API — les quatre golden signals*.

Sans Grafana, les quatre mêmes chiffres en une commande, depuis le dépôt :

```bash
./scripts/releve.sh "constat"
```

Les six panneaux, dans l'ordre où on les regarde :

| # | Panneau | La question à laquelle il répond |
| --- | --- | --- |
| 1 | Disponibilité | est-ce que ça répond, oui ou non |
| 2 | Trafic | est-ce que quelqu'un appelle encore |
| 3 | Erreurs | quelle **part** des appels rate |
| 4 | Latence p95 | est-ce que c'est lent |
| 5 | Tâches en base | est-ce que les données sont toujours là |
| 6 | Codes de statut | **de quoi** il s'agit : 503 = la base, 500 = le code |

Un panneau vide alors que l'application tourne veut dire que la source de
données ou le nom de la métrique est faux — jamais que « Grafana bugge ».
Un panneau *Erreurs* vide veut dire qu'aucune requête n'arrive, ce qui est une
information en soi.

---

## 6. Pannes connues et leur signature

C'est ce qui transforme ce document en outil de diagnostic. **Commencez toujours
par relever la signature avant de toucher à quoi que ce soit** : les trois
premières lignes se ressemblent au premier coup d'œil et se réparent
différemment.

| Panne | `up` | Erreurs | `docker ps -a` sur la cible | Réparation |
| --- | --- | --- | --- | --- |
| 6.1 API arrêtée | **0** | pas de données | `todo-api` **`Exited (0)`** | § 6.1 |
| 6.2 Base arrêtée | **1** | **~65 % de 503** | `todo-api` `Up`, `todo-db` **absent** | § 6.2 |
| 6.3 API coupée du réseau | **0** | pas de données | `todo-api` **`Up`** | § 6.3 |
| 6.4 API relancée sans configuration | **0** | pas de données | `todo-api` **`Exited (1)`** ou `Restarting` | § 6.4 |
| 6.5 Machine saturée | 0 ou 1, clignote | timeouts | tout est `Up`, mais lent | § 6.5 |

> **Les deux distinctions qui font gagner le plus de temps.**
>
> **`up = 0`, trois causes possibles**, et la commande qui répare l'une ne
> répare pas les autres. C'est `docker ps -a` qui les sépare, et il faut lire
> le **code de sortie**, pas seulement le mot `Exited` :
>
> | Ce que montre `docker ps -a` | Ce qui s'est passé | Aller à |
> | --- | --- | --- |
> | `Exited (0)` | arrêt propre, quelqu'un a fait `docker stop` | § 6.1 |
> | `Exited (1)` ou `Restarting` | le process a planté au démarrage, il lui manque quelque chose | § 6.4 |
> | `Up` | le conteneur va bien, c'est le chemin réseau qui est coupé | § 6.3 |
>
> **Ne vous fiez pas au panneau Trafic pour dire « plus personne n'appelle ».**
> Si le trafic vient d'un générateur, il a pu mourir avec la panne. De vrais
> utilisateurs, eux, continuent d'appeler. Un trafic à zéro veut dire
> « personne n'obtient de réponse », pas « personne ne demande ».

Le premier réflexe, dans tous les cas :

```bash
cible 'docker ps -a --format "table {{.Names}}\t{{.Status}}"'
cible 'docker logs --tail 10 todo-api'
```

> **Tapez ces deux commandes AVANT d'ouvrir Grafana.** Les panneaux 2, 3 et 4
> reposent sur `rate(...[1m])` : ils ont besoin d'une minute de données avant
> de refléter ce qui vient de se produire. Trente secondes après le début
> d'une panne, le panneau *Erreurs* affiche encore 0 % en toute bonne foi.
> `docker ps -a` répond, lui, dans la seconde. Seul le panneau
> *Disponibilité* est immédiat, parce qu'il ne calcule aucun taux — il bascule
> en 4 secondes, mesuré.
>
> Le tableau de bord sert à **savoir qu'il y a un problème** et à voir combien
> de temps il a duré. Il ne sert pas à identifier lequel dans les premières
> secondes.

**Lisez les logs par la fin.** Les lignes plus anciennes peuvent venir d'un
incident précédent et vous envoyer sur une fausse piste : c'est arrivé au
premier exercice, où huit lignes `ENOTFOUND todo-db` d'un incident antérieur
précédaient le `SIGTERM recu` qui, lui, disait la vérité.

### 6.1 — Le conteneur de l'API est arrêté

**Signature :** `up` à 0 (en moins de 15 s), `todo-api` en **`Exited (0)`**, et
la dernière ligne de `docker logs todo-api` est `SIGTERM recu, arret en cours`.
Le zéro et le SIGTERM disent la même chose : personne n'a planté, quelqu'un a
arrêté le conteneur.

```bash
cible 'cd /srv/todo && docker compose up -d todo-api'
```

**Vérification :** `curl -s http://127.0.0.1:13000/health` répond en moins de
10 s, et le panneau *Disponibilité* repasse à `EN LIGNE`.

### 6.2 — La base est arrêtée

**Signature :** `up` reste à **1** — la cible répond toujours — mais le panneau
*Erreurs* monte vers 65 % et le panneau 6 montre un flot de **503**. `/health`
répond `ok`, `/api/tasks` répond
`{"error":"base de donnees injoignable, reessayez plus tard"}`.

```bash
cible 'cd /srv/todo && docker compose up -d todo-db'
```

**Vérification :** `curl -s http://127.0.0.1:13000/api/tasks` répond une liste
JSON. Le panneau *Tâches en base* remonte à sa valeur d'avant, et le panneau
*Erreurs* redescend à 0 en moins d'une minute.

> **Ne redémarrez pas l'API.** Elle va parfaitement bien : elle distingue déjà
> « la base est absente » (503) de « j'ai un bug » (500). La redémarrer fait
> perdre une minute et ne change rien.

### 6.3 — L'API est coupée du réseau interne

**Signature :** `up` à 0, mais `docker ps` montre `todo-api` bien `Up`. Le port
13000 ne répond plus non plus (la publication du port suit le réseau).

```bash
cible 'docker network connect todo-prod todo-api'
```

Si la commande répond `already exists`, ce n'est pas cette panne. En cas de
doute, la remise à plat qui répare toutes les variantes :

```bash
cible 'cd /srv/todo && docker compose up -d --force-recreate todo-api'
```

**Vérification :** `curl -s http://127.0.0.1:13000/health` répond `ok`, et
`cible 'docker inspect -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}" todo-api'`
affiche `todo-prod`.

### 6.4 — L'API a été relancée à la main, sans sa configuration

**Signature :** `up` à 0, `todo-api` en `Exited` ou en `Restarting` en boucle.
Les logs contiennent
`Variable d'environnement obligatoire manquante : DB_HOST`.

C'est un conteneur lancé par un `docker run` hors compose : il n'a ni le `.env`,
ni le réseau, ni le nom de la base. On ne le répare pas, on le remplace :

```bash
cible 'docker rm -f todo-api && cd /srv/todo && docker compose up -d todo-api'
```

**Vérification :** `curl -s http://127.0.0.1:13000/health` répond `ok`, et
`cible 'cd /srv/todo && docker compose ps'` liste bien quatre services.

> C'est exactement le scénario que la CI/CD est censée éliminer : quelqu'un a
> tapé une commande à la main sur la machine de production. Le déploiement
> normal (§ 2) écrase toujours ce genre d'état.

### 6.5 — La machine est saturée

**Signature :** le p95 explose (plusieurs secondes), le trafic s'effondre sans
que personne n'ait arrêté d'appeler, `up` clignote entre 0 et 1. Tous les
conteneurs sont `Up`.

```bash
cible 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"'
```

Les coupables sont les conteneurs qui ne font pas partie de la stack (`todo-api`,
`todo-db`, `prometheus`, `grafana` sont légitimes) :

```bash
cible 'docker ps --format "{{.Names}}" | grep -Ev "^(todo-api|todo-db|prometheus|grafana)$" | xargs -r docker rm -f'
```

**Vérification :** `docker stats --no-stream` montre les quatre services
légitimes sous 20 % de CPU, et le p95 redescend sous 50 ms en moins de deux
minutes.

### 6.6 — La machine cible elle-même a disparu

**Signature :** `cible hostname` ne répond pas du tout, `docker ps` **sur le
serveur** ne montre pas de conteneur `vm-prod`.

```bash
cd ~/tp-devops-todo-api
./deploy/vm-prod.sh up          # reconstruit et redémarre la machine cible
cible 'mkdir -p /srv/todo'
scp -i deploy/deploy_key -P 2222 deploy/env.example root@127.0.0.1:/srv/todo/.env
cible 'vi /srv/todo/.env'       # renseigner DB_PASSWORD et GRAFANA_ADMIN_PASSWORD
```

Puis relancer la pipeline (onglet *Actions* → *CI* → *Run workflow* sur `main`)
pour qu'elle y redépose `compose.yml`, `prometheus.yml`, `apply.sh` et
`grafana/`.

**Vérification :** `./deploy/vm-prod.sh status` affiche `running`, `ok`, et le
`{"status":"ok"}` de l'API.

> Si `deploy/deploy_key` a été perdue, il faut regénérer la paire
> (`ssh-keygen -t ed25519 -N "" -f deploy/deploy_key`), reconstruire l'image de
> la machine cible (la clé publique y est incluse) **et** remplacer le secret
> `DEPLOY_SSH_KEY` du dépôt. Les données de la base survivent, elles sont dans
> un volume Docker.

---

## 7. Cas non couverts

Cette procédure ne prévoit pas :

- **le port 13000 déjà occupé sur le serveur par autre chose.** `apply.sh`
  échouerait sur `port is already allocated`. Trouver le coupable avec
  `sudo ss -ltnp | grep 13000` ; si ce n'est pas `vm-prod`, c'est un processus
  hors Docker et il faut décider avec son propriétaire avant de le tuer.
- **une corruption des données.** Aucune sauvegarde de la base n'existe
  aujourd'hui : le volume `pgdata` est la seule copie. C'est un manque assumé
  pour un TP, et le premier à combler pour un vrai service.
- **le runner self-hosted arrêté.** Les jobs restent `Queued` indéfiniment, sans
  message d'erreur. Vérifier avec
  `pgrep -af 'actions-runner.*Runner.Listener'` sur le serveur, relancer avec
  `cd ~/actions-runner && nohup ./run.sh > runner.log 2>&1 &`.

---

## 8. Journal des corrections de cette procédure

Une procédure qui n'a jamais servi n'a jamais été testée. Chaque ligne ici vient
d'un moment où quelqu'un s'est trouvé bloqué devant ce document.

| Date | Ce qui manquait | Correction |
| --- | --- | --- |
| 2026-08-05 | Le § 1 ne disait pas comment vérifier qu'on était bien sur la machine cible et pas sur le serveur hôte. Deux Docker différents, les mêmes commandes. | Ajout du `cible hostname` et de son résultat attendu. |
| 2026-08-05 | Les pannes 6.1, 6.3 et 6.4 donnaient toutes `up = 0` et se réparaient différemment. | Ajout de la colonne `docker ps` au tableau, et de l'encadré qui les sépare. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Le tableau disait « `todo-api` absent » pour 6.1 et « `Exited`ou `Restarting` » pour 6.4 — or 6.1 laisse aussi un conteneur `Exited`. Les deux lignes étaient indiscernables au moment où il fallait choisir. | Le critère devient le **code de sortie** : `Exited (0)` = arrêt propre (6.1), `Exited (1)` = plantage au démarrage (6.4). Ajouté au tableau et au § 6.1. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Rien ne disait de lire les logs par la fin. Huit lignes `ENOTFOUND todo-db` d'un incident précédent précédaient la ligne utile et pointaient vers la mauvaise section. | Ajout de l'avertissement sous le réflexe n° 1, et passage de `--tail=40` à `--tail 10`. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Le panneau *Trafic* était lu comme « plus personne n'appelle », alors que c'est le générateur de charge qui était mort avec la panne (`set -e` + `curl` en échec). | `scripts/charge.sh` survit désormais à sa cible, et la procédure prévient de ne pas conclure depuis ce panneau seul. |
| 2026-08-05, **après le 2ᵉ incident réel** | La procédure envoyait vers le tableau de bord en premier. Or les panneaux 2 à 4 reposent sur `rate([1m])` : au 2ᵉ incident, cinq secondes après l'arrêt de la base, le panneau *Erreurs* affichait encore 0,000 %. `docker ps -a`, lui, montrait déjà `todo-db  Exited (0) 5 seconds ago`. | Ajout de l'encadré sur la latence du tableau de bord, et inversion explicite de l'ordre : les deux commandes d'abord, Grafana ensuite. |

# Procédure de déploiement — Todo API

**Ce document se lit à 3 h du matin, sans réfléchir.** Il n'explique pas
comment le système est construit : il dit quoi taper, dans quel ordre, et
comment savoir que ça a marché. Pour comprendre l'architecture, voir le
`README.md` ; ici, on répare.

Toute commande de ce document se colle telle quelle dans un terminal. Si vous
devez deviner un chemin, un nom ou un port, c'est un défaut de cette procédure :
signalez-le, elle se corrige dans le même commit que le changement qui l'a créé.

> **Version cluster, depuis le 6 août 2026.** La cible n'est plus la machine
> `vm-prod` et son `docker compose`, c'est le cluster Kubernetes
> `todo-cluster`. Ce qui change vraiment est résumé au § 0 ; le reste du
> document a été réécrit en conséquence, pas dupliqué.

| | |
| --- | --- |
| **Durée normale d'un déploiement complet** | ~2 min pipeline comprise, dont **0 seconde d'indisponibilité** (mesuré : 0 requête perdue sur 382) |
| **Durée normale d'un retour arrière** | **25 s** du constat au rétablissement (mesuré) |
| **Au-delà de 5 min sans que l'API réponde** | on ne cherche plus, on revient en arrière (§ 4) |

> Ces durées sont mesurées, pas estimées. Un `rollout` qui dépasse 3 minutes a
> un problème : `kubectl -n todo describe deployment todo-api` le nomme, et le
> § 6 le classe.

---

## 0. Ce qui a changé depuis la version « une machine »

Six lignes à connaître avant tout le reste. Le geste de gauche ne fonctionne
plus ; celui de droite le remplace.

| Hier, sur `vm-prod` | Aujourd'hui, sur `todo-cluster` |
| --- | --- |
| `ssh` + clé privée `deploy/deploy_key` | `kubectl`, avec le kubeconfig déjà en place — **plus aucune clé** |
| `cible 'grep ^TAG= /srv/todo/.env'` | `kubectl -n todo get deployment todo-api -o jsonpath='{.spec.template.spec.containers[0].image}'` |
| `cible '/srv/todo/apply.sh <sha>'` | `kubectl -n todo set image deployment/todo-api todo-api=<image>:<sha>` |
| retour arrière = rejouer un sha connu | `kubectl -n todo rollout undo deployment/todo-api` — **plus besoin de connaître le sha** |
| `docker ps -a` pour voir l'état | `kubectl -n todo get pods` |
| un déploiement coupe le service | **aucune coupure** : les pods sont remplacés un par un |

Une conséquence à retenir avant de paniquer la première fois : **une panne sur
le cluster ne coupe presque jamais le service.** Les trois pods sains
continuent de répondre pendant qu'un quatrième échoue en boucle. C'est
confortable, et c'est un piège — voir l'encadré du § 6.

---

## 1. Ce qu'il faut avoir sous la main avant de commencer

Sans ces quatre éléments, n'ouvrez pas un terminal, vous perdrez du temps.

| Élément | Valeur | Où le trouver |
| --- | --- | --- |
| Cluster | `todo-cluster`, un k3d sur le serveur `ubuntu` | `k3d cluster list` ; s'il manque, § 6.6 |
| Contexte kubectl | `k3d-todo-cluster` | `kubectl config get-contexts` |
| Namespace | `todo` | **toutes** les commandes portent `-n todo` |
| Kubeconfig | `~/.kube/config` sur le serveur | écrit par `k3d cluster create` ; **jamais dans le dépôt** |

Les URL, **toutes sur la boucle locale du serveur** — rien n'est joignable
depuis Internet :

| Service | URL depuis le serveur | Depuis votre poste |
| --- | --- | --- |
| API, par l'Ingress | `curl -H "Host: todo.localhost" http://127.0.0.1:8080/health` | `ssh -L 8080:127.0.0.1:8080 <serveur>` |
| API, dans un navigateur | `http://todo.localhost:8080` | idem, `todo.localhost` se résout tout seul |

> **Pourquoi l'en-tête `Host` dans le `curl` ?** L'Ingress route sur le nom de
> domaine. Sans cet en-tête, Traefik ne trouve aucune règle et répond **404** —
> ce qui n'a rien à voir avec une panne de l'API. Un 404 sur `/health` est
> presque toujours une erreur de `Host`, pas une application morte.

Les deux commandes à taper en premier, toujours, avant même de savoir ce qui se
passe :

```bash
kubectl config use-context k3d-todo-cluster
kubectl -n todo get pods
```

**Vérification :** la première répond `Switched to context "k3d-todo-cluster"`,
la seconde liste **quatre** lignes — trois `todo-api` et un `todo-db` — toutes
en `Running` et `1/1`.

> **Si `kubectl` répond `The connection to the server ... was refused`**, ce
> n'est pas une panne de l'application : c'est le cluster qui n'est plus là.
> Allez directement au § 6.6.

---

## 2. Déploiement normal — il n'y a rien à faire

Un `git push` sur `main` déclenche tout : lint, tests unitaires, tests
d'intégration contre une vraie base, construction de l'image, publication sur
GHCR taguée au sha du commit, puis application des manifestes et `set image`
sur le cluster.

**Aucune commande n'est à taper.** Si vous ouvrez un terminal pour déployer,
c'est qu'il s'est passé quelque chose d'anormal — allez au § 3.

**Vérification, dans cet ordre :**

1. Onglet *Actions* du dépôt : les 5 jobs verts (`Lint`, `Tests unitaires`,
   `Tests d'integration`, `Image Docker`, `Deploiement sur le cluster`).
2. La dernière étape du job de déploiement affiche
   `deployment "todo-api" successfully rolled out` puis
   `L'API repond par l'Ingress apres N tentative(s)`.
3. Depuis le serveur :

   ```bash
   curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/health
   ```

   **Attendu :** `{"status":"ok","timestamp":"..."}`

4. La version qui tourne est bien celle du commit :

   ```bash
   kubectl -n todo get deployment todo-api \
     -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
   ```

   **Attendu :** l'image taguée avec les 40 caractères du sha du dernier commit
   sur `main`.

### Quand un job est rouge

> **Le job de déploiement gate sur `kubectl rollout status`.** C'est la
> différence majeure avec hier : s'il est rouge, c'est que les nouveaux pods ne
> sont **jamais** devenus prêts. Et dans ce cas, **l'ancienne version tourne
> toujours et sert le trafic** — `maxUnavailable: 0` interdit qu'un pod sain
> parte avant qu'un nouveau soit prêt.

C'est l'inverse exact du piège d'hier, où un job rouge pouvait laisser la
nouvelle version en place. Aujourd'hui :

| Job rouge | Ce qui a été fait | État de la production |
| --- | --- | --- |
| `Lint`, `Tests unitaires`, `Tests d'integration` | rien | intacte |
| `Image Docker` | rien n'est publié, le déploiement est `skipped` | intacte |
| `Deploiement`, étape « Le cluster est-il joignable » | rien | intacte, mais **le cluster est en panne** → § 6.6 |
| `Deploiement`, étape « Attendre que le rollout converge » | les manifestes sont appliqués, l'image est posée, **aucun nouveau pod n'est prêt** | **intacte**, l'ancienne version sert |
| `Deploiement`, étape « Verifier … par l'Ingress » | les pods sont prêts | **modifiée** — l'API tourne mais l'Ingress ne la sert pas → § 6.7 |

Dans les deux derniers cas, le job a déjà affiché `get pods`, `describe` et les
événements récents : lisez-les avant toute chose, la réponse y est neuf fois
sur dix. **Un rollout bloqué n'est pas une urgence de service** — personne ne
voit rien — mais il le devient si on l'oublie : la version fautive reste en
attente indéfiniment.

---

## 3. Déploiement manuel d'une version précise

À n'utiliser que si la pipeline ne peut pas faire son travail : runner arrêté,
GitHub indisponible, ou urgence qui ne peut pas attendre.

**Étape 3.1 — Choisir la version.** Les versions déployables sont les sha des
commits **fusionnés** sur `main` : seuls ceux-là ont une image publiée.

```bash
git log --first-parent --format='%H  %s' -10 main
```

**Vérification :** le sha choisi fait 40 caractères. Un sha court ne
fonctionnera pas, les images sont taguées avec le sha complet.

**Étape 3.2 — Appliquer.**

```bash
kubectl -n todo set image deployment/todo-api \
  todo-api=ghcr.io/gabrielsaint-louis/todo-api:<le-sha-complet>
kubectl -n todo rollout status deployment/todo-api --timeout=180s
```

**Vérification :** la seconde commande se termine par
`deployment "todo-api" successfully rolled out`.

> **`set image` réussit toujours, même sur une image qui n'existe pas.** Il
> n'écrit qu'une intention. C'est `rollout status` qui dit la vérité, et lui
> seul : s'il n'a pas rendu la main au bout de 180 s, la nouvelle version n'est
> jamais partie — allez au § 6.3. **Ne tapez jamais `set image` sans le
> `rollout status` qui suit.**

**Étape 3.3 — Confirmer que le service répond.**

```bash
curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/health && echo
curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/api/tasks | head -c 120
```

**Vérification :** `{"status":"ok",...}` puis une liste JSON (éventuellement
`[]`). Une réponse `{"error":"base de donnees injoignable, reessayez plus tard"}`
signifie que l'API est là mais que la base ne répond pas : § 6.2.

**Étape 3.4 — Remettre le dépôt et le cluster d'accord.** Un `set image` tapé à
la main crée un écart entre ce que dit le fichier versionné et ce que fait le
cluster — le *drift*. Le prochain `git push` l'écrasera de toute façon ; si la
version posée à la main doit rester, elle se commite dans
`k8s/todo-api-deployment.yaml`.

---

## 4. Retour arrière

**C'est la section la plus importante de ce document.** Elle se lit en panique,
donc elle tient en une commande.

### Qui décide, et sur quel critère

| Critère observable | Décision | Qui |
| --- | --- | --- |
| L'API ne répond plus depuis plus de **5 minutes** | retour arrière immédiat | la personne d'astreinte, seule, sans appeler personne |
| Plus de **5 %** des réponses en erreur pendant plus de 5 minutes | retour arrière immédiat | idem |
| Un comportement faux mais sans erreur (champ manquant, mauvaise valeur) | retour arrière si un client est impacté | idem |
| Doute | **retour arrière** | idem |

On revient en arrière *d'abord*, on comprend *ensuite*. Un retour arrière coûte
25 secondes et se rejoue ; une enquête menée pendant que le service est mort
coûte des heures. Personne n'a jamais eu de reproche pour être revenu en
arrière trop vite.

### La commande

```bash
# 1. Quelle version tourne en ce moment
kubectl -n todo get deployment todo-api \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

# 2. On revient à la précédente. Aucun sha à connaître : le cluster garde
#    lui-même l'historique de ce qu'il a fait tourner.
kubectl -n todo rollout undo deployment/todo-api
kubectl -n todo rollout status deployment/todo-api --timeout=180s
```

**C'est le gain le plus concret de la journée** : hier, il fallait retrouver le
sha de la version d'avant pour taper la commande. Aujourd'hui, `rollout undo`
sans argument suffit.

### Revenir plus loin que la version précédente

```bash
kubectl -n todo rollout history deployment/todo-api
kubectl -n todo rollout history deployment/todo-api --revision=<N>   # ce qu'elle contient
kubectl -n todo rollout undo deployment/todo-api --to-revision=<N>
```

> **Les numéros de révision ne sont pas contigus.** Relevé le 6 août 2026 :
> 3, 4, 5, 6, 7, 9, 21, 22, 23, 27, 28. Chercher « la révision d'avant » en
> soustrayant 1 donne `error: unable to find specified revision` au pire
> moment. **Listez toujours l'historique avant de choisir un numéro.**

> **Un `undo` sans rien à annuler échoue proprement.** Vérifié le 6 août 2026 :
> `error: no rollout history found for deployment "..."`, code de sortie 1, et
> le Deployment reste exactement dans l'état où il était. Aucun risque à
> essayer.

### La même chose sans terminal

Si vous n'avez ni accès au serveur, ni l'envie de taper du `kubectl` à 3 h du
matin : onglet **Actions** → workflow **Retour arriere** → *Run workflow*. Il
demande le sha et une raison, refuse un sha court avec un message explicite, et
joue exactement les commandes ci-dessus sur le cluster.

Deux avantages sur la voie manuelle : n'importe qui ayant accès au dépôt peut le
déclencher, et le geste laisse une trace horodatée avec le nom de qui l'a lancé.
Un `kubectl` dans un terminal ne laisse rien.

### Vérification, et le piège qui va avec

```bash
curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/api/tasks | head -c 120
```

> **`rollout status` rend la main AVANT que l'ancienne version ait fini de
> servir.** Mesuré le 6 août 2026 : 21,0 s pour que `rollout status` réponde,
> **24,7 s** pour que *toutes* les réponses soient saines. Les anciens pods
> restent dans les endpoints du Service pendant leur `preStop` de 5 secondes.
>
> Conséquence directe pour l'astreinte : **une seule requête de vérification ne
> suffit pas.** Elle peut tomber sur un ancien pod et faire croire que le
> retour arrière a échoué. Répétez-la une dizaine de fois, ou lancez
> `./scripts/mesure-rollback.sh`, qui exige 30 bonnes réponses d'affilée.

### Après le retour arrière

1. Le commit fautif reste sur `main` et **sera redéployé au prochain push**.
   Corrigez-le ou révoquez-le tout de suite (`git revert <sha>`), sinon la
   panne revient toute seule.
2. Notez dans le Journal de bord du `README.md` : l'heure du constat, l'heure du
   rétablissement, ce que `kubectl get pods` montrait.

---

## 5. Regarder l'état du cluster

Grafana : **`http://grafana.localhost:8080`** — identifiant `admin`, mot de
passe dans le Secret :

```bash
kubectl -n todo get secret todo-secret -o jsonpath='{.data.GRAFANA_ADMIN_PASSWORD}' | base64 -d; echo
```

Tableau de bord *Todo API sur le cluster — les quatre golden signals*. Les deux
premiers panneaux méritent d'être lus ensemble, et c'est nouveau :

| Panneau | Ce qu'il dit | Le piège qu'il évite |
| --- | --- | --- |
| **1 · Copies en service** | combien des 3 répondent | `2/3` n'est pas une panne pour l'utilisateur ; c'en est une pour la marge — il ne reste qu'une copie avant la coupure |
| **1 bis · La base répond-elle** | `todo_db_up`, une métrique que l'API ne peut produire qu'en ayant vraiment interrogé Postgres | le panneau 1 peut afficher **3** pendant que celui-ci affiche **INJOIGNABLE** : c'est exactement la limite de `/health`, rendue visible |
| **7 · Quelle copie ne répond pas** | une ligne par pod | les autres panneaux disent *combien*, celui-ci dit *lequel* |

**Quatre alertes**, provisionnées depuis `k8s/monitoring/alertes.yml` :

| Alerte | Se déclenche quand | Après |
| --- | --- | --- |
| Plus aucune copie | `sum(up)` tombe à 0 | 1 min |
| Plus de 5 % d'erreurs | même seuil que le critère de retour arrière du § 4 | 5 min |
| **Une copie ne répond pas** | un pod est déclaré mais `up = 0` | 5 min |
| **La base ne répond plus** | `todo_db_up` tombe à 0 | 2 min |

> **La troisième est celle qui découvre les pannes du § 6.** Aucune des cinq ne
> coupe le service : trois pods sains répondent `200` pendant qu'un quatrième
> échoue en boucle. Vérifié le 6 août 2026 en rejouant la panne 6.3 — l'alerte
> est passée `firing` pendant que `curl` répondait `200` tout du long. Sans
> elle, personne ne se plaint et personne ne regarde.

Sans Grafana, les mêmes questions en quatre commandes :

| La question | La commande |
| --- | --- |
| Est-ce que ça répond ? | `curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/health` |
| Combien de copies sont vraiment en service ? | `kubectl -n todo get pods` |
| Qu'est-ce qui vient de se passer ? | `kubectl -n todo get events --sort-by=.lastTimestamp \| tail -20` |
| Est-ce que ça consomme anormalement ? | `kubectl -n todo top pods` |

Les colonnes de `get pods` se lisent dans cet ordre, et chacune répond à une
question différente :

| Colonne | Ce qu'elle dit | Ce qu'elle **ne** dit **pas** |
| --- | --- | --- |
| `READY` (`1/1`) | la readinessProbe passe, le Service lui envoie du trafic | que l'application rende le bon service — voir l'encadré ci-dessous |
| `STATUS` | l'état du conteneur : `Running`, `ImagePullBackOff`, `CrashLoopBackOff`, `OOMKilled` | pourquoi — c'est `describe` qui le dit |
| `RESTARTS` | combien de fois le conteneur est mort et a été relancé | ce qui l'a tué ; `describe` → `Last State` |
| `AGE` | depuis quand ce pod existe | depuis quand il va mal |

> **`READY 1/1` ne veut pas dire « l'application va bien ».** Les deux sondes
> interrogent `/health`, qui répond `ok` **sans jamais toucher la base**.
> Mesuré le 6 août 2026 : base arrêtée, les trois pods restent `1/1`, aucun
> événement `Unhealthy`, et pourtant `GET /api/tasks` répond `503`.
>
> **Depuis le 6 août 2026, la question a sa propre route.** `/health` n'a pas
> bougé — les sondes restent branchées dessus, exprès, pour qu'une base lente
> ne fasse pas retirer les trois copies du Service d'un coup. C'est `/ready`
> qui dit la vérité sur la base :
>
> ```bash
> curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/ready
> ```
>
> | Réponse | Ce que ça veut dire |
> | --- | --- |
> | `200 {"status":"ready","base":"joignable"}` | tout va bien |
> | `503 {"status":"degraded","detail":"..."}` | le serveur écoute, la base ne répond pas. Le champ `detail` porte le message brut de `pg`, qui sépare « nom introuvable » de « connexion refusée » de « mot de passe invalide » — trois pannes, trois remèdes |

---

## 6. Pannes connues et leur signature

C'est ce qui transforme ce document en outil de diagnostic. **Commencez toujours
par relever la signature avant de toucher à quoi que ce soit.**

**Les cinq signatures ci-dessous ont été observées, pas déduites** : chaque panne
a été déclenchée pour de vrai le 6 août 2026 via `k8s/chaos.sh`, et les valeurs
sont relevées.

| Panne | `kubectl -n todo get pods` | `describe` / events | Se répare seule ? | Aller à |
| --- | --- | --- | --- | --- |
| 6.1 Pod supprimé | un nom disparaît, un autre apparaît en `Running` | `SuccessfulCreate` sur le ReplicaSet | **Oui**, ~14 s | rien à faire |
| 6.2 Processus tué dans le conteneur | même nom de pod, `RESTARTS` passe à 1 | `Last State: Terminated`, `Reason: Completed`, `Exit Code: 0` | **Oui**, ~13 s | rien à faire |
| 6.3 Tag d'image inexistant | 3 pods sains **+ 1** en `ErrImagePull` puis `ImagePullBackOff` | `Failed to pull image … not found`, `Back-off pulling image` | **Non** | § 6.3 |
| 6.4 Clé du Secret supprimée | 3 pods sains **+ 1** en `CrashLoopBackOff`, `RESTARTS` qui grimpe | `Exit Code: 1`, logs : `Variable d'environnement obligatoire manquante : DB_PASSWORD` | **Non** | § 6.4 |
| 6.5 Limite mémoire trop basse | 3 pods sains **+ 1** en `CrashLoopBackOff` — **la même chose que 6.4** | `Reason: OOMKilled`, `Exit Code: 137`, **logs vides** | **Non** | § 6.5 |

> **AUCUNE DES CINQ N'A COUPÉ LE SERVICE.** `curl` répondait `200` pendant les
> cinq, y compris les trois qui ne se réparent pas. C'est le résultat le plus
> important du tableau, et le plus dangereux : **une panne qui ne fait pas
> sonner le téléphone reste en place jusqu'à ce que quelqu'un regarde.** Le
> compte de pods est le seul indicateur immédiat — 4 lignes au lieu de 3 pour
> `todo-api`, dont une qui ne passe jamais `1/1`.

> **Les trois pannes qui ne se réparent pas ont exactement la même forme :** un
> pod de trop, coincé, pendant que les autres vont bien.
>
> **`kubectl get pods` ne suffit PAS à les séparer.** Vérifié le 6 août 2026 en
> suivant cette procédure sur un incident tiré au sort : la panne 6.5 affichait
> `CrashLoopBackOff`, exactement comme 6.4. Le `OOMKilled` de la colonne
> `STATUS` n'apparaît que par intermittence, entre deux redémarrages — s'y fier
> envoie une fois sur deux au mauvais paragraphe.
>
> **C'est `describe`, et lui seul, qui tranche** :
>
> | `describe` → `Last State` | Ce qui s'est passé | Aller à |
> | --- | --- | --- |
> | `STATUS: ImagePullBackOff` / `ErrImagePull` (visible dès `get pods`) | l'image demandée n'existe pas, ou le registry refuse | § 6.3 |
> | `Reason: Error`, **`Exit Code: 1`** | l'application a décidé de mourir, et a écrit pourquoi dans ses logs | § 6.4 |
> | `Reason: OOMKilled`, **`Exit Code: 137`** | le noyau l'a tuée, elle n'a rien écrit du tout | § 6.5 |
>
> **Le code de sortie est le seul critère fiable** : `1` = l'application a
> décidé de mourir et a écrit pourquoi ; `137` = elle a été tuée et n'a rien
> écrit. La commande qui donne la réponse en une ligne :
>
> ```bash
> kubectl -n todo describe pod <le-pod> | grep -A3 "Last State"
> ```

Le premier réflexe, dans tous les cas :

```bash
kubectl -n todo get pods
kubectl -n todo describe pod <le-pod-qui-ne-va-pas> | tail -25
```

> **`describe` avant `logs`, toujours, et pas l'inverse.** La panne 6.5 ne
> laisse **aucun log** : le processus est tué par le noyau avant d'écrire quoi
> que ce soit. Sa cause n'existe **que** dans `describe`, ligne `Last State`.
> Chercher dans les logs sur cette panne-là, c'est chercher là où rien n'a
> jamais été écrit.

**Et les logs, quand il y en a, se lisent par le début :**

```bash
kubectl -n todo logs <pod> | head -20
```

Un conteneur qui plante au démarrage écrit son message utile en tête, enterré
sous sa pile d'appels. Mesuré au jour 3, toujours vrai : `--tail 10` n'affiche
que des lignes `at Module._load (...)`, qui ne disent rien à personne.

### 6.1 — Un pod a disparu

**Signature :** un nom de pod change dans `get pods`, un nouveau apparaît, le
compte revient à 3 en une quinzaine de secondes.

**Rien à faire.** C'est la boucle de réconciliation qui travaille. Le service
n'a pas été interrompu : les deux autres pods ont absorbé le trafic.

**Vérification :** `kubectl -n todo get pods` montre 3 pods `1/1` et
`RESTARTS` à 0 sur le nouveau.

### 6.2 — Le processus est mort dans le conteneur

**Signature :** le nom du pod **ne change pas**, mais sa colonne `RESTARTS`
passe à 1 et son `AGE` reste ancien. `describe` montre
`Last State: Terminated`, `Reason: Completed`, `Exit Code: 0`.

**Rien à faire.** Le kubelet a relancé le conteneur dans le même pod.

> **La distinction avec 6.1 tient au nom du pod**, et elle compte : un pod
> supprimé est **remplacé** (nom neuf, `RESTARTS` à 0), un processus mort est
> **relancé** (même nom, `RESTARTS` incrémenté). La seconde forme signale un
> problème *dans* l'application ; la première, un événement extérieur. Un
> `RESTARTS` qui grimpe tout seul au fil des heures est un symptôme à ne jamais
> laisser passer, même si le pod finit toujours par revenir.

### 6.3 — Le tag d'image n'existe pas

**Signature :** un pod de trop, en `ErrImagePull` puis `ImagePullBackOff`. Les
trois autres vont bien. `describe` :
`Failed to pull image "...:<tag>": ... not found`.

C'est le cas normal après un `set image` avec une faute de frappe, ou vers un
commit dont l'image n'a jamais été publiée.

```bash
kubectl -n todo rollout undo deployment/todo-api
kubectl -n todo rollout status deployment/todo-api --timeout=180s
```

**Vérification :** `kubectl -n todo get pods` revient à 3 pods `1/1`, et
l'image du Deployment est de nouveau celle d'avant (§ 4, commande 1).

> Cette panne est celle que le job de déploiement attrape tout seul : il gate
> sur `rollout status` et devient rouge. Si vous la trouvez à la main, c'est
> qu'elle vient d'un `set image` tapé hors pipeline.

### 6.4 — Une clé de configuration a disparu

**Signature :** un pod de trop, en `CrashLoopBackOff`, `Exit Code: 1`,
`RESTARTS` qui grimpe. **Les logs disent la cause en toutes lettres :**

```bash
kubectl -n todo logs <le-pod> | head -20
```

**Attendu :**
`Error: Variable d'environnement obligatoire manquante : DB_PASSWORD.`

L'application refuse de démarrer sans sa configuration, plutôt que de se
connecter à une base au hasard. C'est voulu depuis le jour 1.

```bash
kubectl apply -f k8s/todo-secret.yaml
kubectl -n todo rollout restart deployment/todo-api
kubectl -n todo rollout status deployment/todo-api --timeout=180s
```

> **`k8s/todo-secret.yaml` n'est pas dans le dépôt** (il contient le mot de
> passe en clair). Il vit sur le serveur, à côté du dépôt. S'il a disparu lui
> aussi, le modèle est `k8s/todo-secret.example.yaml` — mais le mot de passe
> doit alors être **celui que la base connaît déjà**, sinon l'API démarrera très
> bien et se fera refuser par PostgreSQL.

> **Le `rollout restart` n'est pas décoratif.** Un ConfigMap ou un Secret
> modifié ne pousse **rien** vers un pod déjà vivant : il faut le relancer pour
> qu'il relise son environnement. Mesuré le 6 août 2026 : `NODE_ENV` passé à
> `staging` côté cluster, le pod continuait de répondre `production`.

### 6.5 — La limite mémoire est trop basse

**Signature :** un pod de trop, en `OOMKilled` ou `CrashLoopBackOff`,
`Exit Code: 137`, et **`kubectl logs` ne renvoie rien du tout**.

```bash
kubectl -n todo describe pod <le-pod> | grep -A3 "Last State"
```

**Attendu :** `Reason: OOMKilled`.

```bash
kubectl -n todo patch deployment todo-api --type=json \
  -p='[{"op":"remove","path":"/spec/template/spec/containers/0/resources"}]'
kubectl -n todo rollout status deployment/todo-api --timeout=180s
kubectl apply -f k8s/todo-api-deployment.yaml   # remet les valeurs versionnées
```

> **`kubectl apply -f` ne suffit PAS à réparer cette panne**, et c'est le piège
> le plus coûteux des cinq. Vérifié deux fois le 6 août 2026 :
>
> | Tentative | `resources` après |
> | --- | --- |
> | `kubectl apply -f k8s/todo-api-deployment.yaml` | `{"limits":{"memory":"8Mi"}}` — inchangé |
> | `kubectl apply --server-side --force-conflicts -f …` | `{"limits":{"memory":"8Mi"}}` — inchangé |
> | `kubectl patch … --type=json -p '[{"op":"remove",…}]'` | `{}` ✅ |
>
> `apply` ne supprime que les champs **qu'il a lui-même posés** auparavant. Un
> champ ajouté par `kubectl patch` appartient à un autre propriétaire, et un
> manifeste qui n'en parle pas ne le retire pas — il ne le mentionne
> simplement pas. **Il faut retirer le champ explicitement.**

Les valeurs légitimes, trouvées par l'échec (phase 12, détail au `README.md`) :
`requests` 24Mi / 50m, `limits` 48Mi / 500m. Le plancher mesuré est entre 20Mi
(OOMKilled) et 24Mi (tenu).

### 6.6 — Le cluster lui-même a disparu

**Signature :** `kubectl` répond
`The connection to the server ... was refused`, ou `k3d cluster list` ne montre
pas `todo-cluster`.

```bash
k3d cluster list
k3d cluster start todo-cluster        # s'il existe mais est arrêté
```

S'il n'existe plus du tout, il se reconstruit — **et les données de la base sont
perdues**, la PVC vit dans le nœud :

```bash
docker stop vm-prod 2>/dev/null      # libère le port 8080 et de la RAM
k3d cluster create todo-cluster -p "8080:80@loadbalancer"
kubectl create namespace todo
kubectl apply -f k8s/todo-secret.yaml     # le fichier hors dépôt, d'abord
kubectl apply -f k8s/todo-config.yaml -f k8s/todo-db.yaml \
               -f k8s/todo-api-deployment.yaml -f k8s/todo-api-service.yaml \
               -f k8s/todo-ingress.yaml
kubectl -n todo rollout status deployment/todo-api --timeout=300s
```

**Vérification :** `kubectl get nodes` montre `k3d-todo-cluster-server-0` en
`Ready`, et `curl -H "Host: todo.localhost" http://127.0.0.1:8080/health` répond
`ok`.

> **L'ordre compte :** le Secret d'abord. `todo-db.yaml` lit `DB_NAME`,
> `DB_USER` et `DB_PASSWORD` dedans, et un pod PostgreSQL démarré sans eux crée
> une base avec de mauvais identifiants — que l'API ne pourra plus joindre.

### 6.7 — Les pods vont bien, l'Ingress ne sert rien

**Signature :** `kubectl -n todo get pods` montre 3 pods `1/1`, et pourtant
`curl` répond **404** ou **502**.

```bash
kubectl -n todo get ingress,svc,endpoints
```

| Ce que vous voyez | Ce qui s'est passé |
| --- | --- |
| `endpoints todo-api` vide (`<none>`) | le `selector` du Service ne colle à aucun pod. Mesuré : 3 pods `Running` et **44 requêtes sur 44 en 503** |
| `404` sur `/health` mais `200` sur `/api/tasks` | la règle de l'Ingress porte un `path` trop étroit (`/api` au lieu de `/`) |
| `404` sur tout, avec l'en-tête `Host` correct | le `backend.service.port.number` de l'Ingress ne correspond à aucun port du Service. Traefik ne crée alors **aucune** route et répond 404 — **pas** une erreur de passerelle |
| `404` sur tout, **sans** en-tête `Host` | ce n'est pas une panne : voir l'encadré du § 1 |

```bash
kubectl apply -f k8s/todo-api-service.yaml -f k8s/todo-ingress.yaml
```

---

## 7. Cas non couverts

Cette procédure ne prévoit pas :

- **la perte du nœud lui-même.** Les sauvegardes existent désormais (§ 9), mais
  la PVC des dumps vit sur le **même disque** que celle des données. Une
  sauvegarde qui ne quitte pas la machine qu'elle protège ne protège que des
  bêtises humaines, pas des pannes matérielles. C'est le manque restant, et
  c'est le premier à combler pour un vrai service.
- **la restauration à une date précise** (*point-in-time recovery*). Le CronJob
  tourne toutes les six heures : au pire, six heures de saisie sont perdues.
  Réduire cette fenêtre demande l'archivage des WAL, un autre sujet.
- **le port 8080 déjà occupé sur le serveur.** `k3d cluster create` échouerait.
  Trouver le coupable avec `ss -ltnp | grep 8080` ; sur cette machine c'est
  presque toujours la stack `docker compose` du jour 1
  (`docker stop todo-todo-api-1`).
- **le runner self-hosted arrêté.** Les jobs restent `Queued` indéfiniment, sans
  message d'erreur. Vérifier avec
  `pgrep -af 'actions-runner.*Runner.Listener'`, relancer avec
  `cd ~/actions-runner && nohup ./run.sh > runner.log 2>&1 &`.
- **`kubectl` absent du PATH du runner.** Le job de déploiement le vérifie en
  première étape et le dit explicitement — mais il ne l'installe pas.

---

## 9. Sauvegarde et restauration

Un `CronJob` dumpe la base toutes les six heures sur une PVC distincte, et garde
les douze derniers fichiers (trois jours).

```bash
# Ce qui existe
./scripts/restaurer.sh

# Forcer un dump maintenant — le réflexe AVANT toute opération risquée
kubectl -n todo create job --from=cronjob/todo-db-sauvegarde avant-migration
kubectl -n todo logs job/avant-migration
```

**Restaurer**, sachant que c'est irréversible :

```bash
./scripts/restaurer.sh todo-20260806T120805Z.sql.gz
```

Le script affiche ce qu'il va écraser et exige qu'on tape `RESTAURER` en toutes
lettres. Il se termine par `RESTAURATION_OK` et liste les tâches présentes.

> **La restauration a été jouée, pas seulement écrite.** Le 6 août 2026 : table
> vidée par un `TRUNCATE` volontaire, dump rejoué, la tâche témoin est revenue
> et celle créée après le dump a bien disparu.
>
> **Et la première tentative a échoué.** Le `pg_dump` d'origine ne contenait que
> des `CREATE TABLE` : le rejouer sur une base dont la table existe encore —
> c'est-à-dire le cas le plus fréquent, une table vidée par erreur — s'arrêtait
> sur `ERROR: relation "tasks" already exists`. La sauvegarde existait, elle
> était valide, et elle ne se restaurait pas. Corrigé par `--clean --if-exists`.
> **Une sauvegarde jamais restaurée n'est pas une sauvegarde.**

---

## 8. Journal des corrections de cette procédure

Une procédure qui n'a jamais servi n'a jamais été testée. Chaque ligne ici vient
d'un moment où quelqu'un s'est trouvé bloqué devant ce document.

| Date | Ce qui manquait | Correction |
| --- | --- | --- |
| 2026-08-05 | Le § 1 ne disait pas comment vérifier qu'on était bien sur la machine cible et pas sur le serveur hôte. Deux Docker différents, les mêmes commandes. | Ajout du `cible hostname` et de son résultat attendu. |
| 2026-08-05 | Les pannes donnant toutes `up = 0` se réparaient différemment. | Ajout de la colonne `docker ps` au tableau, et de l'encadré qui les sépare. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Le critère `Exited` ne séparait pas un arrêt propre d'un plantage au démarrage. | Le critère devient le **code de sortie** : `Exited (0)` = arrêt propre, `Exited (1)` = plantage. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Rien ne disait de lire les logs par le bon bout. Des lignes d'un incident précédent pointaient vers la mauvaise section. | Deux règles au lieu d'une, choisies par le statut du conteneur. |
| 2026-08-05, **après le 1ᵉʳ incident réel** | Le panneau *Trafic* était lu comme « plus personne n'appelle », alors que c'est le générateur de charge qui était mort avec la panne. | `scripts/charge.sh` survit désormais à sa cible, et la procédure prévient de ne pas conclure depuis ce panneau seul. |
| 2026-08-05, **après avoir cassé `main` exprès 3 fois** | Rien ne disait ce qu'un job rouge implique pour la production. | Ajout du tableau « quand un job est rouge » au § 2. |
| 2026-08-05, **après vérification des pannes 3, 4 et 5** | Trois signatures sur cinq étaient **raisonnées, pas observées**, et l'une d'elles était franchement fausse. | Les cinq lignes du tableau sont désormais mesurées. |
| 2026-08-05, **en se servant du retour arrière** | `apply.sh` écrivait le sha **avant** de télécharger l'image : le seul fichier que la procédure fait lire pendant une panne mentait. | `apply.sh` télécharge d'abord, n'écrit qu'ensuite. |
| **2026-08-06, passage au cluster** | Toute la procédure décrivait une machine unique, un `docker compose` et une clé SSH. Rien de tout ça n'existe plus. | Réécriture, pas duplication : § 0 qui met les gestes d'hier et d'aujourd'hui en regard, et tous les § adaptés à `kubectl`. Le fichier garde son nom et son historique. |
| **2026-08-06, après avoir joué les 5 pannes** | Le § 2 d'hier avertissait qu'un job rouge pouvait laisser la nouvelle version en place. Avec le gate sur `rollout status`, c'est l'**inverse** : un job rouge garantit que l'ancienne version sert toujours. Garder l'avertissement d'hier ferait revenir en arrière une version qui n'a jamais été déployée. | Tableau du § 2 refait, et la garantie énoncée en clair. |
| **2026-08-06, après avoir joué les 5 pannes** | Aucune des cinq ne coupe le service. Une procédure qui ne le dit pas laisse croire qu'un service qui répond est un service sain. | Encadré en tête du § 6, et le compte de pods promu au rang d'indicateur n° 1. |
| **2026-08-06, en réparant la panne 5** | Le réflexe légitime, `kubectl apply -f` sur le manifeste versionné, **ne répare pas** la panne 5 — même en `--server-side --force-conflicts`. Suivre la procédure au mot près laissait le pod en `OOMKilled` en croyant l'avoir réparé. | § 6.5 réécrit avec les trois tentatives mesurées et le `patch remove` qui, seul, fonctionne. |
| **2026-08-06, en chronométrant le retour arrière** | La vérification tenait en un `curl`. Or `rollout status` rend la main 3,7 s avant que tous les pods aient basculé : ce `curl` unique pouvait tomber sur un ancien pod et faire croire à un échec. | Encadré au § 4 avec les deux durées mesurées, et la consigne de répéter la requête. |
| **2026-08-06, en relisant le § 6.6 à voix haute** | La reconstruction du cluster appliquait les manifestes dans l'ordre du dossier, Secret compris — or `todo-db.yaml` lit ses identifiants dedans. Un PostgreSQL démarré avant le Secret crée une base que l'API ne pourra jamais joindre. | L'ordre est explicite : le Secret d'abord, avec la raison. |
| **2026-08-06, sur un incident tiré au sort, numéro inconnu à l'avance** | Le tableau annonçait `OOMKilled` dans la colonne `kubectl get pods` pour la panne 6.5. En vrai, elle s'affichait `CrashLoopBackOff` — **exactement comme la 6.4**. Suivi au mot près, le document envoyait au § 6.4, où le `kubectl logs` recommandé ne renvoie rien du tout (le noyau tue avant que quoi que ce soit soit écrit) : impasse complète, sur la seule panne du lot qui n'écrit aucun log. | La colonne `get pods` de 6.5 dit désormais « la même chose que 6.4 », l'encadré affirme en toutes lettres que `get pods` **ne suffit pas**, et le critère devient le `Exit Code` relevé par `describe`, avec la commande exacte. |
| **2026-08-06, après avoir remonté la surveillance** | Le § 5 disait qu'il n'existait aucun tableau de bord ni aucune alerte sur le cluster, et le § 7 le listait comme le premier manque à combler. Les deux sont faux depuis que Prometheus et Grafana tournent dans le cluster. | § 5 réécrit avec les panneaux, les quatre alertes et leurs seuils. Et une alerte qui n'existait pas hier : « une copie ne répond pas », la seule chose qui découvre les pannes du § 6, puisqu'aucune ne coupe le service. |
| **2026-08-06, après avoir ajouté `/ready`** | Le § 5 concluait « le seul test qui ne ment pas est une vraie requête métier ». C'était vrai, et insuffisant : un `GET /api/tasks` en erreur ne dit pas si le problème vient de la base ou du code. | `/ready` répond précisément à cette question, avec le message brut de `pg` dans son champ `detail`. `/health` n'a pas bougé, et le § 5 explique maintenant pourquoi c'est délibéré. |
| **2026-08-06, en restaurant une sauvegarde pour la première fois** | Le CronJob écrivait des dumps valides depuis le début, et aucun ne se restaurait : sans `--clean --if-exists`, rejouer un dump sur une base dont la table existe encore s'arrête sur `relation "tasks" already exists`. C'est-à-dire précisément dans le cas où on restaure, une table vidée par erreur. | `--clean --if-exists` ajouté, dump refait, restauration jouée pour de vrai. Nouveau § 9, et la règle en tête : une sauvegarde jamais restaurée n'est pas une sauvegarde. |

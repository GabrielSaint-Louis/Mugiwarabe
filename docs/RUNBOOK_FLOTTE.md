# Runbook de la flotte Mugiwarabe

Ce document est ecrit pour l'equipage qui s'en servira, pas pour celui qui l'a
ecrit. Si vous le lisez sans nous connaitre et que vous bloquez quelque part,
c'est le document qui est en tort, pas vous.

Vous n'avez besoin de rien d'autre que ce depot et un poste avec Docker.

---

## 1. Ce que vous avez sous les yeux

Quatre services et une base. Trois choses a savoir avant de toucher quoi que ce
soit :

| Le service | Ce qu'il fait | Si vous le coupez |
|---|---|---|
| `front` | la page du quiz, seul service publie | la classe ne peut plus jouer, le reste tourne |
| `api` | les questions, les scores, **et le pavillon** | le front s'affiche mais sans donnees |
| `classement` | agrege les scores | le front s'affiche sans classement |
| `vigie` | fabrique des questions via un modele externe | rien de visible, la reserve existante suffit |
| `db` | PostgreSQL, **pas de carre au tableau** | l'API, le classement et la vigie passent en 503 |

**La base n'a pas de carre.** Le jour ou elle coule, c'est le carre de l'API qui
s'eteint. Un carre vide qui designe une panne situee ailleurs, c'est la premiere
chose a savoir lire ici.

---

## 2. Les trois commandes qu'on tape quand un carre s'eteint

Dans cet ordre. Pas dix, trois, celles qu'on tape a 3h du matin sans reflechir.

### 2.1 Est-ce que le conteneur est la ?

```bash
ssh -i deploy_key -p 2222 root@localhost 'cd /srv/flotte && docker compose -f compose.prod.yml ps'
```

Ce que ca ecarte :

- **Le service est absent ou en `Restarting`** : c'est une panne de demarrage.
  Configuration incomplete (panne 4) ou image introuvable (panne 5). Allez voir
  ses logs, la cause y est ecrite en clair.
- **Le service est `Up (healthy)`** : le conteneur va bien. Si son carre est
  eteint au tableau, la panne est **entre le service et le tableau** (panne 6).
  Passez directement en 2.3.
- **Le service est `Up (unhealthy)`** : il tourne mais sa dependance ne repond
  pas. Regardez `db` dans la meme liste (panne 2).

### 2.2 Qu'est-ce qu'il raconte ?

```bash
ssh -i deploy_key -p 2222 root@localhost 'cd /srv/flotte && docker compose -f compose.prod.yml logs --tail 30 <service>'
```

Les messages qui comptent, tous prefixes du sous-systeme qui les emet :

| Ce que vous lisez | Ce que ca veut dire |
|---|---|
| `[config] DB_PASSWORD est obligatoire` | panne 4, le secret a disparu du `.env` |
| `[db] connexion au repos perdue` | la base est tombee, le service tient |
| `[pouls] tableau injoignable` | panne 6, le service va bien, le chemin non |
| `[pavillon] source injoignable` | l'API redemarre, sans gravite |
| `[vigie] fabrication impossible` | le modele externe, sans gravite |

### 2.3 Est-ce qu'il repond vraiment ?

```bash
ssh -i deploy_key -p 2222 root@localhost \
  "cd /srv/flotte && docker compose -f compose.prod.yml exec -T <service> \
   node -e \"require('http').get('http://127.0.0.1:3000/sante', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log(d)) })\""
```

La reponse contient `version` et `dependances`. **C'est ce qui separe les deux
pannes qui se ressemblent le plus** : un service qui repond `etat: ok` avec un
carre eteint au tableau, c'est la panne 6 et rien d'autre.

---

## 3. Les six pannes

| # | La panne | Au tableau | Ce qui a casse | La manoeuvre |
|---|---|---|---|---|
| 1 | conteneur tue | un carre s'eteint puis revient seul | le process est mort, `restart: unless-stopped` le relance | aucune, on attend |
| 2 | base coupee | le carre de l'API palit ou s'eteint, le front reste plein | rien dans l'API, sa dependance a disparu | `docker compose start db` |
| 3 | pavillon muet | le pavillon disparait, tous les carres restent pleins | `/data` n'est plus lisible, le service tourne | `exec api chmod 755 /data` |
| 4 | secret efface | un carre s'eteint au redemarrage suivant | configuration incomplete, image intacte | relancer le workflow, il reecrit le `.env` |
| 5 | version introuvable | un carre s'eteint et ne revient pas | le tag demande n'existe pas sur le registry | relancer le workflow sur un commit valide |
| 6 | tableau injoignable | un carre s'eteint alors que le service va parfaitement bien | rien, sauf le chemin entre le service et le tableau | corriger `TABLEAU_URL`, relancer le workflow |

**Un mot sur la reparation de la panne 3.** Remettre `/data` lisible repare la
cause, mais le tableau garde la derniere valeur declaree jusqu'au pouls suivant :
il y a donc jusqu'a cinq secondes ou tout est repare et ou l'ecran ment encore.
Dites-le a voix haute pendant que vous reparez, sinon vous allez croire que la
manoeuvre a echoue et tenter quelque chose de plus brutal.

**La sixieme est la plus retorse.** Le tableau ne dit pas si votre service va
bien, il dit **si votre service arrive a raconter qu'il va bien**. Quelqu'un qui
ouvre l'application dans son navigateur pendant que le carre est eteint le
decouvre en dix secondes ; quelqu'un qui ne regarde que le tableau cherche vingt
minutes.

Pour toutes les pannes qui touchent au `.env` (4, 5, 6), **la reparation est la
meme** : relancer le workflow. Il reecrit ce fichier entierement depuis les
secrets du depot. Ne le corrigez pas a la main, vous ne feriez que reporter le
probleme au prochain deploiement.

```bash
gh workflow run flotte.yml --ref main
```

---

## 4. Remonter la flotte de zero, sur une autre machine

C'est la section qui compte. Depuis un poste vierge, avec ce depot et rien
d'autre.

### 4.1 Ce qu'il vous faut

- Docker et Docker Compose
- un acces au depot GitHub et le droit de lire ses images sur ghcr.io
- la cle privee de deploiement, **qui n'est pas dans ce depot** : elle vit dans
  les secrets du depot, sous le nom `DEPLOY_KEY`

### 4.2 La machine cible

La flotte tourne sur `vm-prod`, un conteneur qui embarque un serveur SSH et son
propre Docker. Il se reconstruit depuis `deploy/Dockerfile.vm` :

```bash
docker build -f deploy/Dockerfile.vm -t vm-prod .
docker run -d --name vm-prod --privileged \
  -p 127.0.0.1:2222:22 -p 127.0.0.1:13000:3000 \
  -p 127.0.0.1:19090:9090 -p 127.0.0.1:13001:3001 \
  vm-prod
```

Quatre ports, et il faut les quatre : 2222 pour SSH, 3000 pour le front, 9090
pour Prometheus, 3001 pour Grafana.

Verifiez avant d'aller plus loin :

```bash
ssh -i deploy_key -p 2222 root@localhost 'docker ps'
```

Doit repondre sans erreur de connexion, la liste peut etre vide.

### 4.3 Le runner

Le job de livraison tourne sur un runner **self-hosted**, et ce n'est pas un
choix de confort : un runner heberge chez GitHub ne peut pas ouvrir de connexion
vers un poste sans adresse publique. C'est le meme mur qui impose que le pouls
parte de vos services vers le tableau, et jamais l'inverse.

```bash
cd ~/actions-runner
TOKEN=$(gh api -X POST repos/<compte>/<depot>/actions/runners/registration-token --jq .token)
./config.sh --url https://github.com/<compte>/<depot> --token "$TOKEN" \
  --name vm-prod-host --labels self-hosted,vm-prod --work _work --unattended --replace
sudo ./svc.sh install "$USER" && sudo ./svc.sh start
```

Le runner doit apparaitre `online` :

```bash
gh api repos/<compte>/<depot>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
```

**Si vous sautez cette etape**, le job de livraison restera en attente
indefiniment, sans message d'erreur. C'est le piege le plus couteux de cette
procedure.

### 4.4 Les secrets

Trois secrets et une variable, sans lesquels la flotte ne peut pas etre livree :

| Nom | Type | Ce que c'est |
|---|---|---|
| `DEPLOY_KEY` | secret | la cle privee SSH vers la machine cible |
| `DB_PASSWORD` | secret | le mot de passe de la base |
| `GROQ_API_KEY` | secret | la cle du modele, **facultative** |
| `TABLEAU_URL` | variable | l'adresse du tableau de la classe |

```bash
gh secret set DEPLOY_KEY  --repo <compte>/<depot> < deploy_key
gh secret set DB_PASSWORD --repo <compte>/<depot> --body '<un mot de passe>'
gh variable set TABLEAU_URL --repo <compte>/<depot> --body 'https://<adresse>'
```

`GROQ_API_KEY` peut rester vide : la vigie demarre quand meme et se rabat sur la
reserve de questions existante.

### 4.5 Livrer

```bash
gh workflow run flotte.yml --ref main
```

Puis verifiez, **sur la machine cible et pas sur la coche verte de GitHub** :

```bash
ssh -i deploy_key -p 2222 root@localhost \
  'cd /srv/flotte && docker compose -f compose.prod.yml ps'
```

Les cinq conteneurs doivent etre `healthy`. Comptez **une minute** entre le push
et le dernier service a jour.

### 4.6 Le pavillon

Il ne se remonte pas tout seul : le volume est neuf sur une machine neuve.

```bash
ssh -i deploy_key -p 2222 root@localhost \
  "cd /srv/flotte && docker compose -f compose.prod.yml exec -T api node -e \"
   const d=JSON.stringify({pavillon:'Je serai le Roi des DevOps https://lespagesafrocarib.com/mugiwarabe/luffy.png'});
   const r=require('http').request({host:'127.0.0.1',port:3000,path:'/pavillon',method:'POST',
     headers:{'Content-Type':'application/json','Content-Length':d.length}},x=>console.log(x.statusCode));
   r.write(d);r.end();\""
```

Doit repondre `201`. Les trois autres services le recuperent ensuite tout seuls,
en moins de quinze secondes.

---

## 5. Revenir en arriere

Le `.env` de la machine cible est reecrit a **chaque** deploiement, avec le sha
du commit comme `TAG`. Revenir en arriere consiste donc a rejouer le workflow
sur un commit precedent :

```bash
gh workflow run flotte.yml --ref <sha du commit precedent>
```

Comptez la meme minute que pour une livraison normale.

**Ne modifiez pas le `TAG` a la main dans le `.env`.** Ca marche, et le prochain
deploiement ecrasera votre correction sans prevenir.

---

## 6. Ce qu'on sait qui ne va pas

Un runbook qui ne liste que ce qui marche ment par omission.

- **Une livraison par compose eteint les carres.** `docker compose up -d`
  remplace les conteneurs, il ne les double pas. Le portage sur le cluster
  (palier 7) est ce qui corrige ca, avec un rolling update.
- **Le pavillon ne dit jamais que l'API est tombee.** Les trois suiveurs gardent
  leur copie locale, donc il reste affiche. C'est voulu pour le tableau, mais ne
  vous en servez pas comme signal.
- **La sonde du front n'est jamais rouge a cause de l'API.** Elle repond 200 avec
  `degrade: true`. C'est le comportement voulu, il faut juste le savoir avant de
  conclure que le front va bien.
- **Le `chmod 600` du `.env` arrive apres son ecriture.** Fenetre de quelques
  millisecondes. Sans consequence sur une machine ou seul root se connecte, a
  corriger si ce n'est plus le cas.

# Journal de bord de la flotte Mugiwarabe

Une entree par incident, y compris ceux qu'on n'a pas su reparer. Surtout
ceux-la : une panne comprise et non reparee apprend plus qu'une panne reparee
sans avoir ete comprise.

Tenu par Amine, en astreinte.

---

## Avant l'ouverture du feu : ce qu'on s'est inflige tout seuls

Ces quatre incidents sont arrives pendant la construction, en cassant nous-memes.
Aucun n'aurait ete visible avant la demo si on ne les avait pas cherches.

### I-01. L'API mourait quand la base tombait

**Ce qu'on a fait** : arrete la base a la main pour verifier que la sonde
passait bien en 503.

**Ce qui s'est passe** : le conteneur de l'API est sorti en code 1. Pas de
degradation, pas de 503 : plus rien.

**Ce que le tableau aurait montre** : deux carres eteints pour une seule panne.
Celui de l'API, parce qu'elle etait morte, et le diagnostic serait parti chercher
un bug dans l'API alors que le probleme etait dans la base.

**La cause** : Postgres ferme les connexions que le pool gardait au repos.
`node-postgres` remonte cette erreur sur l'objet `Pool` et non sur une requete.
Personne ne l'attend, Node la traite comme une exception non capturee, et le
process meurt.

**La manoeuvre** : `pool.on('error')`. On ne repare rien dedans, on refuse de
mourir.

**Ce qu'on en retient** : une dependance qui tombe ne doit jamais pouvoir tuer
celui qui en depend. On a verifie les trois autres services dans la foulee, le
classement et la vigie avaient le meme trou.

---

### I-02. Un service sortait en code 1 sans rapport avec ce qu'on venait d'ecrire

**Ce qu'on a fait** : demarre le service classement pour la premiere fois.

**Ce qui s'est passe** :

    Cannot find package 'prom-client' imported from /app/partage/mesure.js

**La cause** : `node_modules` etait installe dans `services/<x>/`, et la
resolution de Node remonte les dossiers **parents**. `/app/partage` n'a jamais
`/app/services/api` au-dessus de lui.

**La manoeuvre** : poser les dependances a la racine de l'image, ou les deux
emplacements les voient.

**Ce qu'on en retient** : le message d'erreur designait le classement, la cause
etait dans une decision prise pour l'API deux heures plus tot. On a corrige les
deux images ensemble.

---

### I-03. Un coup coutait deux secondes quand l'API etait morte

**Ce qu'on a fait** : chronometre `/travail` sur le front dans les deux etats,
avant de valider la PR.

**Ce qui s'est passe** :

| Etat | Duree d'un coup |
|---|---|
| API debout | 7 ms |
| API morte | **2001 ms** |

**Ce que le tableau aurait montre** : les coups partent par paquets de dix. 300
coups font 30 paquets, donc **60 secondes**. Le pouls suivant aurait ete bloque
tout ce temps, le retard se serait accumule, et **le carre du front aurait pali
pour une panne situee dans l'API**.

**La manoeuvre** : un disjoncteur par dependance. Apres un echec, on arrete
d'appeler pendant trois secondes et on repond tout de suite en degrade.

| Apres correction, API morte | |
|---|---|
| premier coup | 2001 ms, il ouvre le disjoncteur |
| coups suivants | 0 ms |
| salve de 40 coups | **484 ms** contre 80 s avant |

**Ce qu'on en retient** : ca protege aussi l'API. Une dependance en difficulte
qui recoit 300 appels de plus par pouls ne se remet jamais. Sans ce reglage, on
aurait transforme une panne courte en panne longue nous-memes.

---

### I-04. Le pavillon disparaissait au redeploiement, mais pas la ou on croyait

**Ce qu'on a fait** : hisse le pavillon, puis declenche un vrai redeploiement
complet.

**Ce qui s'est passe** :

    api        : present
    classement : present
    vigie      : PERDU
    front      : present

**La cause** : au redeploiement, les cinq conteneurs repartent ensemble. Celui
qui demande le pavillon a la premiere seconde tombe sur une API qui n'ecoute pas
encore. Avec un seul intervalle de trente secondes, il declarait un pavillon vide
pendant une demi-minute.

**La manoeuvre** : quatre essais rapproches au demarrage, a 0, 2, 5 et 10
secondes, puis le rythme normal.

**Ce qu'on en retient, et c'est le plus interessant de la journee** : le sujet
nous prevenait que le piege du pavillon etait **l'endroit ou on l'ecrit**. Chez
nous, le volume a fait son travail du premier coup. C'est **le moment ou on va le
chercher** qui etait faux. Si on s'etait contentes de verifier que le fichier
etait dans un volume, on aurait coche la case et le pavillon aurait clignote
pendant la demo sans qu'on comprenne pourquoi.

Verifie ensuite sur deux redeploiements complets d'affilee : les quatre services
declarent le pavillon a quinze secondes.

---

### I-05. Les quatre images ont echoue ensemble au premier passage de la pipeline

**Ce qu'on a fait** : pousse la pipeline sur `main` pour la premiere fois.

**Ce qui s'est passe** : les quatre jobs rouges en quelques secondes.

    ERROR: failed to build: Cache export is not supported for the docker driver.

**La cause** : le cache GitHub Actions demande un driver capable d'exporter des
couches. Le driver `docker` par defaut ne sait pas le faire, et l'echec arrive
**avant meme la lecture du Dockerfile**.

**La manoeuvre** : `docker/setup-buildx-action@v3` avant l'etape de
construction.

**Ce qu'on en retient** : le `fail-fast: false` a paye immediatement. Les quatre
jobs sont alles au bout et ont donne le meme message, ce qui a designe la
pipeline plutot qu'un Dockerfile. Avec le reglage par defaut, GitHub aurait
annule les trois autres des le premier echec et on aurait commence par
soupconner le front.

---

### I-06. Une pipeline rouge heritee de la veille

**Ce qu'on a fait** : rien. Elle s'est declenchee toute seule au premier merge.

**Ce qui s'est passe** : `npm error Missing script: "lint"`.

**La cause** : l'ancien `ci.yml` de la Todo API tournait encore alors que le
`package.json` qu'il visait n'existait plus.

**La manoeuvre** : le retirer.

**Ce qu'on en retient** : un workflow qui echoue sans qu'on sache pourquoi est
pire que pas de workflow du tout. Au bout de deux echecs, plus personne ne
regarde la couleur, et c'est precisement le jour ou elle devient rouge pour une
vraie raison.

---

## Les six pannes tirees

Toutes tirees sur la machine cible, avec les quatre panneaux sous les yeux.

| # | Ce que les panneaux montraient | Ce qu'on a nomme | Vrai ? | Reparee en |
|---|---|---|---|---|
| 1 | un service disparait des cibles, aucune dependance ne bouge | conteneur mort | oui | 12 s |
| 2 | les quatre dependances a TOMBEE d'un coup | la base | oui | 13 s |
| 3 | tout vert, aucun panneau ne bouge | pavillon, ou panne 6 | a moitie | 13 s |
| 4 | un service disparait des cibles et y revient en boucle | configuration | oui | 22 s |
| 5 | **absolument rien ne bouge** | on n'a pas su | non | 1 s |
| 6 | tout vert, aucun panneau ne bouge | pavillon, ou panne 6 | a moitie | 23 s |

### I-07. La politique de redemarrage ne fait pas ce qu'on croyait

**Ce qu'on a fait** : tire la panne 1, un conteneur tue.

**Ce qu'on attendait** : `restart: unless-stopped` relance le conteneur, le
carre revient tout seul en quelques secondes.

**Ce qui s'est passe** : rien. `Exited (137)`, `RestartCount=0`, et il serait
reste mort toute la journee.

**La cause** : Docker distingue un process qui meurt d'un conteneur qu'on lui a
demande d'arreter. `docker kill` entre dans la seconde categorie quel que soit
le signal envoye. La politique protege d'un crash applicatif, pas d'une commande
d'arret. On a verifie les deux facons de tuer, `docker kill` et
`docker compose kill` : meme resultat.

**Ce qu'on en retient** : on aurait attendu devant l'ecran qu'un carre revienne
tout seul, en public. Le runbook dit maintenant de ne pas attendre.

### I-08. La panne 5 n'eteint aucun carre, et c'est pire

**Ce qu'on a fait** : tire la panne 5, un tag d'image qui n'existe pas.

**Ce qu'on attendait** : le carre s'eteint et ne revient pas.

**Ce qui s'est passe** : `manifest unknown`, et **le conteneur precedent a
continue de tourner**. Sonde verte, carre plein, service parfaitement
fonctionnel. Douze minutes d'uptime affichees comme si de rien n'etait.

**Ce qu'on en retient** : c'est la panne la plus silencieuse des six. Au tableau
elle ressemble a un deploiement qui n'a jamais eu lieu, et la seule chose qui
change est le tag affiche sur le carre, qui ne bouge pas alors qu'on vient de
livrer. C'est exactement la question 4 du tableau de bord : est-ce que la
version qui tourne est celle qu'on croit ?

C'est aussi la seule des six qu'on n'a pas su nommer en regardant l'ecran. On
l'assume : elle ne produit aucun signal visuel, et il faut aller lire le tag.

### I-09. Les pannes 3 et 6 sont indiscernables sur les panneaux

**Ce qu'on a fait** : tire les deux, chacune leur tour.

**Ce qui s'est passe** : dans les deux cas, tous les panneaux sont verts. Les
dependances repondent, les cibles sont la, la latence est normale.

**La difference est ailleurs** : la panne 3 fait disparaitre le **pavillon**, la
panne 6 fait disparaitre un **carre**. Les deux se lisent sur le tableau de la
classe, pas sur nos panneaux.

**Ce qu'on en retient** : nos quatre panneaux repondent a la question "est-ce
que la flotte va bien". Ils ne repondent pas a la question "est-ce que la flotte
arrive a le raconter". C'est une limite qu'on assume, parce qu'ajouter un
cinquieme panneau qui surveille notre propre pouls reviendrait a surveiller le
surveillant. La bonne reponse est le reflexe, pas le panneau : panneaux verts
plus carre eteint, la panne est entre nous et le tableau.


---

## Sur le cluster

### I-10. Le rolling update ne suffisait pas tout seul

**Ce qu'on a fait** : porte la flotte sur le cluster, avec `maxUnavailable: 0`
et `maxSurge: 1`, puis livre une nouvelle version en sondant le front deux fois
par seconde.

**Ce qu'on attendait** : zero sonde perdue. C'est la promesse de
`maxUnavailable: 0` : aucun pod n'est retire avant que son remplacant ne soit
pret.

**Ce qui s'est passe** : deux sondes sans reponse. Mieux que les quatre de
compose, mais pas zero.

**La cause** : une course entre deux choses que Kubernetes fait **en parallele**
quand un pod passe en `Terminating`. Il envoie `SIGTERM` au conteneur, et il
retire le pod des Endpoints du Service. Notre process est propre, il ferme son
serveur des le `SIGTERM`. Il est meme trop propre : il se ferme avant que Traefik
n'ait fini de propager le retrait, et les requetes deja routees vers lui tombent
dans le vide.

**La manoeuvre** : un `preStop` de cinq secondes, plus une grace period de vingt.
Le pod continue de servir pendant que la propagation se termine.

| | Sondes | Sans reponse | Reussite |
|---|---|---|---|
| avant | 184 | 2 | 98,9 % |
| apres | 171 | **0** | **100 %** |

**Ce qu'on en retient** : sur le papier, la configuration etait deja correcte.
Ce defaut ne se trouve qu'en mesurant, et il aurait ete invisible pendant une
demonstration calme. Il ne se serait vu que pendant l'ouverture du feu, au moment
ou la classe tire, c'est-a-dire au pire moment.

### I-11. L'API est le seul service qu'on ne sait pas livrer sans interruption

**Ce qu'on a constate** : l'API tourne a un seul exemplaire, en strategie
`Recreate`, alors que les trois autres sont a deux exemplaires en rolling update.

**La cause** : elle monte la PVC du pavillon, et `local-path` sur k3d ne fournit
que du **ReadWriteOnce**. Deux pods ne peuvent pas monter le meme volume, donc
ni replicas a deux, ni rolling update : le nouveau pod attendrait indefiniment
un volume que l'ancien tient encore.

**Ce qu'on n'a pas fait, et pourquoi** : on aurait pu deplacer le pavillon dans
la base, ce qui aurait libere l'API de son volume. Ca marche, c'est meme la
deuxieme ligne defendable du tableau du sujet. On ne l'a pas fait parce que ca
deplace le probleme sans le resoudre : la base est deja le goulot mesure au
palier 4, et lui ajouter une ecriture a chaque hissage de pavillon n'aide pas.

**Ce qu'on assume** : l'API subit une interruption courte pendant une livraison,
les trois autres non. Le front, celui que la classe regarde, est du bon cote.
C'est une limite connue, ecrite ici et dans le README, pas un oubli.
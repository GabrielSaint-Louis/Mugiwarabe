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

*(rempli au fur et a mesure du palier 5)*

| # | Tiree a | Ce qu'on a vu au tableau | Ce qu'on a nomme | Vrai ? | Reparee en |
|---|---|---|---|---|---|
| | | | | | |

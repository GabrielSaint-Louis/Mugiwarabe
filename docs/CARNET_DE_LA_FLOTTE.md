# Carnet de la flotte Mugiwarabe

Les releves chiffres de la journee, y compris les decevants. Surtout les
decevants : un chiffre qui contredit ce qu'on attendait apprend plus qu'un
chiffre qui le confirme.

Tenu par Amine (Mesure).

---

## 1. Taille des images

Mesure prise sur l'image finale, apres publication sur le registry.

| L'image | Taille | Ce qui explique l'ecart |
|---|---|---|
| `api` | 205 Mo | node:20-alpine, multi-stage, `npm ci --omit=dev` |
| `classement` | 205 Mo | idem |
| `vigie` | 205 Mo | idem |
| `front` | 282 Mo | Next, sortie `standalone` |

L'ecart de 77 Mo du front vient de Next et de React, pas d'un defaut de
construction. La sortie `standalone` est justement ce qui l'empeche d'etre bien
pire : sans elle, l'image emporterait l'integralite de `node_modules`, dont
TypeScript et les outils de build.

Les trois autres partagent la meme base et les memes dependances, d'ou trois
chiffres identiques.

---

## 2. Duree entre le push et le dernier carre a jour

Mesure prise sur la machine cible, en interrogeant `/sante` de chaque service
jusqu'a ce qu'il declare le nouveau sha. **Pas sur la coche verte de GitHub** :
la pipeline affiche vert des que les sondes repondent, ce qui peut preceder la
bascule complete de plusieurs dizaines de secondes.

| La livraison | front | api | classement | vigie | Total |
|---|---|---|---|---|---|
| push anodin | 58 s | 59 s | 59 s | 60 s | **60 s** |
| retour arriere | 48 s | 48 s | 48 s | 49 s | **49 s** |

Les quatre services basculent en moins de deux secondes les uns des autres :
`docker compose up -d` les remplace quasiment ensemble. Au tableau, les quatre
carres changeront donc de tag presque simultanement, et pas l'un apres l'autre.

**Le retour arriere complet, du push au dernier service a jour : 57 secondes**
(49 s de bascule plus le temps de construction des images, qui sont en cache).

---

## 3. Ce qu'une livraison coute, vue du dehors

Sonde sur `/sante` du front, deux fois par seconde, pendant toute la livraison.
On mesure ce que voit quelqu'un qui frappe a la porte, pas le statut `healthy`
de Docker : un conteneur est `health: starting` alors qu'il repond deja, et il
reste `healthy` plusieurs secondes apres avoir cesse de repondre.

| La facon de livrer | Sondes | Sans reponse | Absence | Reussite |
|---|---|---|---|---|
| `up -d` **sans changement de version** | 326 | 0 | aucune | 100 % |
| `up -d` **avec changement de version** | 384 | 4 | **environ 2 s** | 99,0 % |
| rolling update sur le cluster | *(palier 7)* | | | |

La premiere ligne est l'idempotence : rejouer le meme deploiement ne recree
rien, donc ne coupe rien. Les 19 questions en base etaient toujours la apres le
second passage.

La deuxieme est le vrai cout d'une livraison par compose : **environ deux
secondes ou le front ne repond pas**. C'est ce que le rolling update doit ramener
a zero.

---

## 4. Capacite : ce que la flotte encaisse

Salves tirees depuis l'interieur de la flotte, sur `/travail`, par paquets
paralleles comme le fait le pouls. Mesurer a travers un port publie mesurerait
aussi la traversee du reseau de la machine.

### 4.1 Un seul exemplaire de chaque service

| Le service | Coups | Encaisses | Debit | Mediane | p95 |
|---|---|---|---|---|---|
| `api` | 200 (x10) | 200/200 | 526/s | 6 ms | 97 ms |
| `classement` | 200 (x10) | 200/200 | 510/s | 5 ms | 36 ms |
| `vigie` | 200 (x10) | 200/200 | 517/s | 6 ms | 97 ms |

### 4.2 On pousse l'API jusqu'a la rupture

| Coups | Parallele | Encaisses | Debit | Mediane | p95 |
|---|---|---|---|---|---|
| 500 | 50 | 500/500 | 816/s | 25 ms | 69 ms |
| 1000 | 50 | 1000/1000 | 992/s | 23 ms | 72 ms |
| 2000 | 50 | 2000/2000 | 1353/s | 17 ms | 31 ms |
| 5000 | 200 | 5000/5000 | 1559/s | 52 ms | 224 ms |
| 5000 | 500 | 5000/5000 | **1593/s** | 148 ms | 399 ms |

**Aucun coup rate, a aucun niveau.** Le debit plafonne vers 1600 coups par
seconde, et ce qui se degrade est la latence, pas le taux de reussite.

### 4.3 Nombre de coups avant que le carre ne palisse

Le carre palit quand plus de quarante coups s'accumulent en retard. Le tableau en
envoie au maximum 300 par pouls, et le pouls bat toutes les cinq secondes.

    300 coups a 1593 coups/s = 0,19 s

**Le carre ne devrait pas palir**, meme au maximum de ce que le tableau peut
envoyer. La marge est d'un facteur 25 environ. Ce chiffre sera a reverifier
pendant l'ouverture du feu, quand plusieurs salves se cumuleront.

### 4.4 Temps de retour a un carre plein apres une salve de mille coups

    1000 coups a 992 coups/s = environ 1 seconde

Le retard se resorbe avant le pouls suivant, qui arrive cinq secondes plus tard.

---

## 5. Le chiffre decevant : trois exemplaires encaissent MOINS qu'un

C'est le releve le plus interessant de la journee, parce qu'il contredit
exactement ce qu'on attendait.

| Configuration | Coups | Parallele | Debit | Mediane | p95 |
|---|---|---|---|---|---|
| **1 exemplaire** | 5000 | 500 | **1593/s** | 148 ms | 399 ms |
| **3 exemplaires** | 5000 | 500 | **1298/s** | 169 ms | 561 ms |
| 3 exemplaires | 5000 | 50 | 1290/s | 18 ms | 35 ms |

Trois exemplaires font **18 % de moins**, avec une p95 degradee de 40 %.

### Pourquoi

La base n'a pas ete dupliquee. C'est elle qui fait le travail : la route
`/travail` de l'API lit la manche ouverte et agrege ses reponses, celle du
classement compte les bonnes reponses, celle de la vigie valide une question.
Trois exemplaires ne triplent pas la capacite de Postgres, ils triplent le
nombre de clients qui se disputent la meme.

La verification le confirme : le classement et la vigie, qui lisent la **meme
base** avec un seul exemplaire chacun, plafonnent au meme endroit.

| Service (1 exemplaire) | Coups | Parallele | Debit |
|---|---|---|---|
| `api` | 5000 | 500 | 1593/s |
| `classement` | 5000 | 500 | 1499/s |
| `vigie` | 2000 | 500 | 955/s |

Trois services differents, trois codes differents, un plafond du meme ordre : le
goulot est commun, et il est en aval.

### Ce qu'on en fait

Rien, et c'est une decision. Dupliquer l'API n'apporte pas de debit tant que la
base est le facteur limitant, et ca coute deux conteneurs. On garde un exemplaire
par service pour l'ouverture du feu, puisque la marge est deja d'un facteur 25.

**Ce qui aurait de l'effet**, dans l'ordre : mettre en cache le resultat de
`/travail` cote service comme le fait deja le classement, alleger la requete
elle-meme, puis seulement ensuite dupliquer.

Le seul gain reel des trois exemplaires apparait a faible parallelisme : la
latence mediane tombe a 18 ms contre 148. Ils ne servent donc pas a encaisser
plus, mais a repondre plus vite quand la charge est moderee. Ce n'est pas ce
qu'on cherchait, mais ca se defend.

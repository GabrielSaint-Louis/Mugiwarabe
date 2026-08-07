# Mugiwarabe

> **Je serai le Roi des DevOps**

<img src="https://lespagesafrocarib.com/mugiwarabe/luffy.png" alt="" align="right" height="150">

Flotte de l'equipage **Mugiwarabe**, pour la Bataille des Services, dernier jour
du TP DevOps.

| | |
|---|---|
| Nom de l'equipage | **Mugiwarabe** |
| Couleur au tableau | `#8B4513` |
| Carres jures | **4** |
| Pavillon | Je serai le Roi des DevOps |
| Application | **Grand Line**, un quiz en direct |

<br clear="right">

## Qui tient quoi

Les roles ne portent pas le nom de la tache mais celui de la personne : a 15h,
quand un carre s'eteint, on appelle quelqu'un et pas un concept.

| Membre | GitHub | Role | Son territoire |
|---|---|---|---|
| Gabriel Saint-Louis | [@GabrielSaint-Louis](https://github.com/GabrielSaint-Louis) | **Livraison + Images** | le workflow, la machine cible, les `Dockerfile` |
| Amine | [@mino-25](https://github.com/mino-25) | **Mesure + Astreinte** | Prometheus, les quatre panneaux, le journal, le runbook |
| Ousmane Ndiaye | [@Sanedoma](https://github.com/Sanedoma) | **Etat** | les volumes, le pavillon, le secret de la base |

L'equipage est a trois : le sujet demande alors que l'astreinte se cumule avec la
mesure, puisque les deux regardent le meme ecran.

**Personne ne fusionne sa propre pull request.** La relecture vient toujours de
quelqu'un d'un autre role, et ca se verifie dans `git log` : l'auteur du commit
de fusion n'est jamais celui de la branche.

## La flotte

| Le service | Ce qu'il fait | Carre |
|---|---|---|
| `front` | la page du quiz, en Next et TypeScript, seul service publie | oui |
| `api` | les questions, les reponses, les scores, **et le pavillon** | oui |
| `classement` | agrege les scores et calcule le classement des manches | oui |
| `vigie` | fabrique de nouvelles questions en parlant a un modele externe | oui |
| `db` | PostgreSQL | **non** |

La base n'a pas de carre, et ce n'est pas un oubli : une base ne parle pas HTTP,
elle ne peut pas envoyer de pouls. Le jour ou elle coule, c'est le carre de
l'API qui s'eteint. Un carre vide qui designe une panne situee ailleurs, c'est
la premiere chose que la classe apprend a lire ici.

## Ce que la flotte tient, mesure

| Ce qu'on a verifie | Le chiffre |
|---|---|
| un `git push` livre la flotte entiere | **60 s** jusqu'au dernier service a jour |
| le meme push rejoue | **326 sondes, 0 echec** |
| ce qu'une livraison coute | **environ 2 s** d'absence du front |
| retour arriere complet | **57 s** |
| capacite d'un service | **1593 coups/s**, aucun rate |
| marge sur ce que le tableau envoie | **facteur 25**, mesure au repos |
| pavillon apres redeploiement | **present a 15 s**, deux fois d'affilee |
| six pannes | toutes tirees, **chronometrees** |

Le detail est dans [le carnet de la flotte](docs/CARNET_DE_LA_FLOTTE.md), y
compris les chiffres decevants. Le plus interessant : **trois exemplaires de
l'API encaissent 18 % de moins qu'un seul**, parce que la base n'a pas ete
dupliquee.

## Le repo

| Chemin | Ce qu'on y trouve |
|---|---|
| `partage/pouls.js` | le pouls fourni par le sujet, importe par les quatre services |
| `partage/mesure.js` | un seul registre Prometheus pour les quatre |
| `partage/pavillon.js` | la diffusion du pavillon aux services qui ne le detiennent pas |
| `services/` | un dossier, un `Dockerfile`, une image par service |
| `compose.prod.yml` | la flotte telle qu'elle tourne sur la machine cible |
| `.github/workflows/flotte.yml` | la pipeline qui livre la flotte entiere |
| `deploy/` | la maquette `vm-prod`, Prometheus, le provisioning Grafana |
| `deploy/grafana/dashboards/flotte.json` | les quatre panneaux |
| `pannes.sh` | le tirage des six pannes |
| `scripts/` | les outils de mesure : livraison, interruption, salve |
| `docs/RUNBOOK_FLOTTE.md` | remonter la flotte de zero sur une autre machine |
| `docs/JOURNAL_DE_BORD.md` | une entree par incident, y compris ceux qu'on n'a pas su reparer |
| `docs/CARNET_DE_LA_FLOTTE.md` | les releves chiffres |

## Monter la flotte

```bash
cp .env.example .env      # puis on remplit
docker compose -f compose.prod.yml up -d
```

Le front repond sur le port `PORT_FRONT`, Prometheus sur `9090`, Grafana sur
`3001`. Pour remonter la flotte **sur une autre machine**, la procedure complete
est dans [le runbook](docs/RUNBOOK_FLOTTE.md).

## Ce qui n'est jamais dans ce depot

Aucun mot de passe, aucune cle privee, aucun fichier d'environnement reel. Seuls
les `.example` sont commites. Un `git log -p` qui ferait apparaitre un secret,
meme supprime depuis, compte comme une fuite.

Trois secrets et une variable vivent dans les reglages du depot : `DEPLOY_KEY`,
`DB_PASSWORD`, `GROQ_API_KEY`, et `TABLEAU_URL`.

## Ce qu'on sait qui ne va pas

Un README qui ne decrit que ce qui marche ment par omission.

- **Une livraison par compose eteint le front deux secondes.** `docker compose
  up -d` remplace les conteneurs, il ne les double pas.
- **Les pannes 3 et 6 sont indiscernables sur nos panneaux.** Ils repondent a
  *est-ce que la flotte va bien*, pas a *est-ce qu'elle arrive a le raconter*.
- **La panne 5 n'eteint aucun carre.** Un tag inexistant laisse l'ancien
  conteneur tourner : au tableau, ca ressemble a un deploiement qui n'a jamais
  eu lieu.
- **`restart: unless-stopped` ne relance pas un conteneur tue par commande.** Il
  protege d'un crash applicatif, pas d'un `docker kill`.
- **La marge de facteur 25 est mesuree au repos**, sans panne en cours et sans
  que la classe tire sur plusieurs flottes en meme temps. On ne sait pas encore
  ce qu'elle vaut pendant l'ouverture du feu.
- **Le tunnel ne sert qu'a l'usage humain.** S'il tombe, la classe ne peut plus
  jouer a la main, mais aucun carre ne palit : les coups du tableau passent par
  le pouls, qui sort de nos services et ne depend pas de cette adresse.

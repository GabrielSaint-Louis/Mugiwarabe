# Échauffement J2 — quatre fichiers cassés

Ces fichiers sont le **support d'exercice** du chapitre « L'essentiel du
diagnostic » (jour 2, avant la CI/CD). Ils ne font pas partie de l'application :
rien ici n'est utilisé par `docker-compose.yml` ni par la chaîne de build du
projet.

| Fichier | Ce qu'il illustre |
| --- | --- |
| `Dockerfile.1` / `.corrige` | lock file absent du `COPY`, et `CMD` en forme shell |
| `Dockerfile.2` / `.corrige` | `COPY . .` avant `npm install` : le cache de layers pour rien |
| `Dockerfile.3` / `.mesurable` / `.corrige` | 1,58 Go, et les trois raisons distinctes de ce poids |
| `docker-compose-broken.yml` / `-corrige.yml` | YAML illisible, puis nom de service qui ne résout pas |

Les diagnostics — symptôme observé, cause, correction, avec les mesures — sont
dans le **Journal de bord** du README à la racine, section
« Jour 2 — Échauffement ».

Pour rejouer :

```bash
# depuis la racine du repo
docker build -f exercices/j2-echauffement/Dockerfile.1 -t debug-1 .
docker compose -f exercices/j2-echauffement/docker-compose-broken.yml --project-directory . config
```

`Dockerfile.3` s'arrête sur `npm run build` (ce projet n'a pas de script
`build`) : `Dockerfile.3.mesurable` retire cette seule ligne pour que la taille
soit mesurable, et c'est lui qui donne les 1,58 Go.

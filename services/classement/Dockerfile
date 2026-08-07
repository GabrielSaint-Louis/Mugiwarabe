# syntax=docker/dockerfile:1

# =============================================================================
#  grandline-classement : le service qui agrege les scores
#
#  Le contexte de build est la RACINE du repo, pas ce dossier : l'image a besoin
#  de partage/pouls.js, qui est commun aux quatre services. C'est la seule
#  entorse au reflexe habituel du contexte le plus etroit possible, et elle est
#  compensee par un .dockerignore qui coupe tout le reste.
#
#    docker build -f services/classement/Dockerfile -t grandline-classement .
# =============================================================================

# ---------- Etage 1 : resolution des dependances -----------------------------
FROM node:20.19.5-alpine AS deps

WORKDIR /app

# Uniquement les manifestes. Cette couche n'est invalidee que si les
# dependances changent : modifier le code ne redeclenche pas l'install.
COPY services/classement/package.json services/classement/package-lock.json ./

# `npm ci` et pas `npm install` : installation strictement reproductible depuis
# le lock file. `--omit=dev` : aucune dependance de dev dans l'image livree.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Etage 2 : image finale -------------------------------------------
FROM node:20.19.5-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# L'arborescence du repo est reproduite telle quelle dans l'image. Ca peut
# surprendre, mais c'est ce qui permet a services/classement/src/serveur.js d'importer
# ../../../partage/pouls.js exactement pareil sur le poste du developpeur et
# dans le conteneur. Aplatir l'arborescence obligerait a deux chemins
# differents, donc a un code qui ne tourne que dans l'un des deux mondes.
# node_modules est a la racine de l'image, pas dans le dossier du service.
# partage/ vit a cote de services/, et la resolution de Node remonte les
# dossiers parents : posees ici, les dependances sont visibles depuis les deux
# endroits. Posees dans services/<x>/, partage/mesure.js ne trouverait pas
# prom-client, et le service sortirait en code 1 au demarrage.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node services/classement/package.json ./services/classement/
COPY --chown=node:node services/classement/src ./services/classement/src
COPY --chown=node:node partage ./partage

# Utilisateur non privilegie. Sans cette ligne, une faille applicative donne un
# acces root a l'interieur du conteneur.
USER node

EXPOSE 3000

# La sonde du Dockerfile reste volontairement basique : elle verifie que le
# serveur HTTP repond. Celle du compose, ajoutee en phase 6, ira plus loin et
# interrogera vraiment la base.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/sante', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Forme exec et non forme shell : node devient PID 1 et recoit directement le
# SIGTERM de docker stop, d'ou un arret propre et un carre qui s'eteint vite.
# VOLONTAIREMENT FAUX. Ce commit sert a prouver que la pipeline sait devenir
# rouge : le fichier n'existe pas, le conteneur sortira immediatement, et
# l'etape de verification doit echouer plutot que d'afficher un vert qui ment.
# Il est annule par le commit suivant.
CMD ["node", "services/classement/src/nexistepas.js"]

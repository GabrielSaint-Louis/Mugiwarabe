# syntax=docker/dockerfile:1

# =============================================================================
#  todo-api - Dockerfile de production
#
#  Ce qui le distingue de Dockerfile.simple, ligne par ligne :
#   - image de base epinglee sur une version precise, jamais un tag flottant
#   - multi-stage : les deps sont resolues dans un etage jete a la fin
#   - COPY des manifestes AVANT le code : `npm ci` reste en cache a chaque commit
#   - npm ci --omit=dev : installation deterministe, sans dependances de dev
#   - USER node : le process final n'a plus les droits root
#   - HEALTHCHECK : Docker distingue "demarre" de "repond vraiment"
#   - CMD en forme exec : node est PID 1 et recoit SIGTERM
# =============================================================================

# ---------- Etage 1 : resolution des dependances -----------------------------
FROM node:20.19.5-alpine AS deps

WORKDIR /app

# Uniquement les manifestes. Cette couche n'est invalidee que si les
# dependances changent : modifier src/ ne redeclenche pas l'install.
COPY package.json package-lock.json ./

# `npm ci` et pas `npm install` : installation strictement reproductible depuis
# le lock file. `--omit=dev` : aucune dependance de dev dans l'image livree.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Etage 2 : image finale -------------------------------------------
FROM node:20.19.5-alpine AS runtime

# NODE_ENV=production : express desactive ses traces de debug. Positionne tot,
# certaines librairies le lisent des le require().
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Seul l'artefact utile traverse depuis l'etage precedent : ni cache npm, ni
# outils de build, ni devDependencies.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Utilisateur non privilegie. L'image officielle node fournit deja un user
# `node` (uid 1000). Sans cette ligne, une faille applicative donne un acces
# root a l'interieur du conteneur.
USER node

# Purement documentaire : EXPOSE n'ouvre aucun port, il declare une intention.
# La publication reelle se fait avec -p, ou `ports:` dans le compose.
EXPOSE 3000

# Sonde de sante : Docker bascule le conteneur en healthy / unhealthy. C'est ce
# que `depends_on: condition: service_healthy` exploite au chapitre 7.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Forme exec (tableau JSON) et non forme shell : node devient PID 1 et recoit
# directement le SIGTERM envoye par `docker stop`, d'ou un arret propre.
CMD ["node", "src/server.js"]

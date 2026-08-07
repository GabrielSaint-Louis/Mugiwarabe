# syntax=docker/dockerfile:1

# =============================================================================
#  grandline-front : la page du quiz
#
#  Trois etages ici, un de plus que les autres services, parce que Next a besoin
#  d'etre construit avant d'etre servi. C'est justement ce que le multi-stage
#  sait faire : la boite a outils de construction ne monte pas a bord.
#
#    docker build -f services/front/Dockerfile -t grandline-front .
# =============================================================================

# ---------- Etage 1 : les dependances, celles de construction comprises ------
FROM node:20.19.5-alpine AS deps

WORKDIR /app

# Les deux manifestes : celui du front, et celui de la racine qui declare ce
# dont partage/ a besoin. Sans le second, la construction echoue sur un
# prom-client introuvable depuis /app/partage.
COPY package.json package-lock.json ./
COPY services/front/package.json services/front/package-lock.json ./services/front/

RUN npm ci && npm ci --prefix services/front

# ---------- Etage 2 : la construction ----------------------------------------
FROM node:20.19.5-alpine AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/front/node_modules ./services/front/node_modules
COPY partage ./partage
COPY services/front ./services/front

RUN npm run build --prefix services/front

# ---------- Etage 3 : image finale -------------------------------------------
FROM node:20.19.5-alpine AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# La sortie standalone de Next : le serveur et les seules dependances qu'il
# utilise vraiment, tracees fichier par fichier a la construction. C'est ce qui
# fait la difference entre une image de 200 Mo et une de 700 : ni TypeScript, ni
# React DOM de developpement, ni les outils de build ne traversent.
COPY --from=build --chown=node:node /app/services/front/.next/standalone ./
COPY --from=build --chown=node:node /app/services/front/.next/static ./services/front/.next/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/sante', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# server.js est genere par Next dans la sortie standalone. Le chemin garde
# l'arborescence du depot grace a outputFileTracingRoot, ce qui permet a
# partage/pouls.js d'etre au bon endroit relatif.
CMD ["node", "services/front/server.js"]

#!/usr/bin/env bash
# =============================================================================
#  Mesure les 4 metriques du chapitre 10 pour un service de la stack.
#
#    ./scripts/measure.sh <service> <contexte> <url-de-sante>
#
#  Exemple :
#    ./scripts/measure.sh todo-api  .          http://127.0.0.1:8080/health
#    ./scripts/measure.sh stats-api ./stats_api http://127.0.0.1:8081/health
#
#  Les 4 metriques, et ce que chacune revele :
#    1. taille          -> ce qui transite a chaque pull
#    2. couches         -> ou le poids se concentre (une couche enorme se cache
#                          derriere une taille totale honnete)
#    3. build froid/chaud -> l'efficacite de l'ordre des instructions
#    4. 1re reponse HTTP  -> la seule qui parle de l'experience de demarrage
# =============================================================================
set -uo pipefail

SERVICE="${1:?usage: measure.sh <service> <contexte> <url-de-sante>}"
CONTEXT="${2:?}"
HEALTH_URL="${3:?}"
IMAGE="todo-${SERVICE}:latest"

cd "$(dirname "$0")/.." || exit 1

ms() { date +%s%3N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", (b - a) / 1000 }'; }

echo "############ $SERVICE ############"

# --- 3. Build a froid ---------------------------------------------------------
# `docker builder prune -af` d'abord : sans ca, la mesure "a froid" s'appuie sur
# un cache residuel et n'est pas comparable d'un jour a l'autre.
docker builder prune -af >/dev/null 2>&1
t0=$(ms)
docker build --no-cache -q -t "$IMAGE" "$CONTEXT" >/dev/null 2>&1 || { echo "build a froid en echec"; exit 1; }
t1=$(ms)
COLD=$(secs "$t0" "$t1")

# --- 3bis. Build a chaud ------------------------------------------------------
# Immediatement apres, sans rien modifier : tout doit sortir du cache.
t0=$(ms)
docker build -q -t "$IMAGE" "$CONTEXT" >/dev/null 2>&1
t1=$(ms)
HOT=$(secs "$t0" "$t1")

# --- 1. Taille ----------------------------------------------------------------
# Docker 29 a scinde l'ancienne colonne SIZE. On releve les deux, plus la somme
# des couches qui correspond a ce que `docker images` affichait historiquement.
DISK=$(docker images "$IMAGE" --format '{{.Size}}')
CONTENT=$(docker image inspect "$IMAGE" --format '{{.Size}}' \
  | awk '{ printf "%.1f Mo", $1 / 1000000 }')
LAYERS_SUM=$(docker history "$IMAGE" --format '{{.Size}}' | awk '
  /GB/ { gsub(/GB/,""); s += $1 * 1000; next }
  /MB/ { gsub(/MB/,""); s += $1;        next }
  /kB/ { gsub(/kB/,""); s += $1 / 1000; next }
  END  { printf "%.1f Mo", s }')

# --- 2. Couches ---------------------------------------------------------------
# Le nombre seul ne dit rien : c'est le poids de la plus grosse qui revele une
# instruction mal placee.
NB_LAYERS=$(docker history "$IMAGE" --format '{{.Size}}' | wc -l)
MAX_LAYER=$(docker history "$IMAGE" --format '{{.Size}}' | awk '
  /GB/ { gsub(/GB/,""); v = $1 * 1000 }
  /MB/ { gsub(/MB/,""); v = $1        }
  /kB/ { gsub(/kB/,""); v = $1 / 1000 }
  /^0B$/ { v = 0 }
  { if (v > m) m = v }
  END { printf "%.1f Mo", m }')

# --- 4. Temps jusqu'a la premiere reponse HTTP 200 ----------------------------
# On chronometre depuis le `up -d` du seul service mesure (--no-deps : la base
# tourne deja, on ne veut pas mesurer son demarrage a elle) jusqu'au premier 200.
docker compose up -d db >/dev/null 2>&1
until [ "$(docker compose ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ]; do sleep 0.2; done
docker compose rm -sf "$SERVICE" >/dev/null 2>&1

t0=$(ms)
docker compose up -d --no-deps "$SERVICE" >/dev/null 2>&1
STARTED=$(ms)
until curl -sf -o /dev/null --max-time 2 "$HEALTH_URL" 2>/dev/null; do
  sleep 0.1
  # Filet de securite : on n'attend pas indefiniment un service qui ne partira pas.
  [ $(( $(ms) - t0 )) -gt 60000 ] && { echo "pas de 200 apres 60 s"; break; }
done
t1=$(ms)

echo "  taille (somme des couches) : $LAYERS_SUM"
echo "  taille (content size)      : $CONTENT"
echo "  taille (disk usage)        : $DISK"
echo "  couches                    : $NB_LAYERS (la plus lourde : $MAX_LAYER)"
echo "  build a froid              : ${COLD} s"
echo "  build a chaud              : ${HOT} s"
echo "  docker compose up rend la main apres : $(secs "$t0" "$STARTED") s"
echo "  premiere reponse HTTP 200            : $(secs "$t0" "$t1") s"
echo

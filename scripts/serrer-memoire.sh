#!/bin/bash
#
# serrer-memoire.sh — jusqu'ou peut-on serrer limits.memory avant que ca casse.
#
#   ./scripts/serrer-memoire.sh 64Mi
#
# Le protocole de la phase 12, automatise pour etre rejouable : poser la limite,
# attendre le pod, le charger, et regarder ce que kubectl top mesure juste avant
# la casse. Le script ne decide rien, il mesure et il dit ce qu'il voit.
#
# Une valeur trouvee AU REPOS ne prouve rien : un process Node au repos tient
# dans 18Mi et explose des la premiere rafale. C'est pour ca que la charge
# tourne pendant la mesure, jamais avant.
set -uo pipefail

LIMITE="${1:?usage: serrer-memoire.sh <valeur, ex 64Mi>}"
NS="${NS:-todo}"
DUREE="${DUREE:-25}"

echo "== limits.memory = $LIMITE =="
kubectl -n "$NS" patch deployment todo-api --type=json \
  -p="[{\"op\":\"add\",\"path\":\"/spec/template/spec/containers/0/resources\",\"value\":{\"limits\":{\"memory\":\"$LIMITE\"}}}]" >/dev/null

# 120s et pas 300 : si le rollout ne converge pas ici, c'est justement le
# resultat qu'on cherchait, inutile d'attendre cinq minutes pour l'apprendre.
if ! kubectl -n "$NS" rollout status deployment/todo-api --timeout=120s >/dev/null 2>&1; then
  echo "RESULTAT : le rollout ne converge pas. Les pods ne demarrent meme pas a $LIMITE."
  kubectl -n "$NS" get pods -l app=todo-api --no-headers | grep -v '1/1'
  exit 2
fi

echo "== charge pendant ${DUREE}s =="
./scripts/charge-cluster.sh "$DUREE" > /tmp/serrer-charge.log 2>&1 &
CHARGE_PID=$!

# Trois relevés pendant la charge : un maximum instantane se rate facilement
# avec une seule mesure prise au mauvais moment.
for _ in 1 2 3; do
  sleep $((DUREE / 4))
  kubectl top pods -n "$NS" -l app=todo-api --no-headers | sed 's/^/   /'
  echo "   ---"
done
wait "$CHARGE_PID"

echo "== verdict =="
kubectl -n "$NS" get pods -l app=todo-api --no-headers
OOM=$(kubectl -n "$NS" get pods -l app=todo-api -o jsonpath='{.items[*].status.containerStatuses[*].lastState.terminated.reason}')
ECHECS=$(grep -oP 'requetes, \K[0-9]+' /tmp/serrer-charge.log)
echo "Requetes echouees sous charge : ${ECHECS:-?}"
if echo "$OOM" | grep -q OOMKilled; then
  echo "RESULTAT : OOMKilled a $LIMITE. Trop serre."
  exit 1
fi
echo "RESULTAT : tenu a $LIMITE."

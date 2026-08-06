#!/bin/bash
#
# mesure-rollback.sh — le retour arriere, chronometre comme une astreinte.
#
#   ./scripts/mesure-rollback.sh
#
# Le chronometre demarre au CONSTAT de la regression (une reponse fausse
# observee), pas au moment ou elle a ete poussee, et s'arrete quand le service
# est reellement revenu.
#
# "Reellement" merite sa definition, et c'est tout l'interet de ce script :
# `kubectl rollout status` rend la main des que les nouveaux pods sont prets,
# alors que les anciens sont encore dans les endpoints du Service le temps de
# leur preStop. Pendant ces quelques secondes, une requete sur deux repond
# encore faux. On exige donc CONSECUTIVES_OK bonnes reponses d'affilee : c'est
# ce qu'un utilisateur appelle "c'est revenu".
set -uo pipefail

NS="${NS:-todo}"
URL="${URL:-http://localhost:8080/api/tasks}"
HOSTHDR="${HOSTHDR:-todo.localhost}"
# La marque d'une reponse saine. Ici le champ que la regression volontaire fait
# disparaitre.
MARQUE="${MARQUE:-\"status\"}"
CONSECUTIVES_OK="${CONSECUTIVES_OK:-30}"

echo "== constat de la regression =="
CONSTAT=$(curl -s -m 3 -H "Host: $HOSTHDR" "$URL")
if echo "$CONSTAT" | grep -q "$MARQUE"; then
  echo "Rien a constater : la reponse contient deja $MARQUE. Rien n'est casse."
  exit 1
fi
echo "   reponse fautive : $(echo "$CONSTAT" | head -c 120)"
T0=$(date +%s.%N)
echo "   chronometre demarre a $(date -u +'%H:%M:%S.%3N') UTC"

echo "== retour arriere =="
kubectl -n "$NS" rollout undo deployment/todo-api
kubectl -n "$NS" rollout status deployment/todo-api --timeout=300s
T_ROLLOUT=$(date +%s.%N)

echo "== on attend $CONSECUTIVES_OK bonnes reponses d'affilee =="
OK=0
while [ "$OK" -lt "$CONSECUTIVES_OK" ]; do
  if curl -s -m 3 -H "Host: $HOSTHDR" "$URL" | grep -q "$MARQUE"; then
    OK=$((OK + 1))
  else
    # Une seule mauvaise reponse remet le compteur a zero : le service n'est
    # pas "a moitie revenu", il est encore casse pour celui qui tombe dessus.
    OK=0
  fi
  sleep 0.1
done
T1=$(date +%s.%N)

echo
echo "---------------- resultat ----------------"
printf "Constat -> rollout status rendu : %.1fs\n" "$(echo "$T_ROLLOUT - $T0" | bc)"
printf "Constat -> service reellement sain : %.1fs\n" "$(echo "$T1 - $T0" | bc)"
echo "   fin a $(date -u +'%H:%M:%S.%3N') UTC"
echo "------------------------------------------"

#!/bin/sh
#
# charge-cluster.sh — charge continue sur l'API DU CLUSTER, via l'Ingress,
# pendant N secondes, et surtout : elle compte.
#
#   ./scripts/charge-cluster.sh 30      (defaut : 30 secondes)
#
# Pourquoi un second script a cote de scripts/charge.sh, plutot qu'une option
# de plus dedans : les deux ne repondent pas a la meme question. Celui du jour 3
# fabrique du trafic pour que les panneaux Grafana bougent, il ne compte rien et
# vise vm-prod sur son port 13000. Celui-ci est un instrument de mesure : il
# vise l'Ingress du cluster et rend un nombre de requetes echouees, le chiffre
# meme qui remplit le tableau de la phase 8. Melanger les deux roles dans un
# fichier donnerait un outil qui ment sur ce qu'il mesure.
#
# Meme lecon qu'au jour 3, gardee ici : aucun `set -e`. Un generateur de charge
# qui meurt au premier echec arrete de compter a la seconde exacte ou il
# devient interessant.
DURATION="${1:-30}"
URL="${URL:-http://localhost:8080/api/tasks}"
HOSTHDR="${HOSTHDR:-todo.localhost}"

END=$(( $(date +%s) + DURATION ))
TOTAL=0
FAILED=0

echo "Charge sur $URL (Host: $HOSTHDR) pendant ${DURATION}s"

while [ "$(date +%s)" -lt "$END" ]; do
  # -m 3 : sans delai maximum, un curl reste pendu sur une cible muette, et la
  # requete perdue n'apparait jamais dans le compteur d'echecs.
  CODE=$(curl -s -m 3 -o /dev/null -w '%{http_code}' -H "Host: $HOSTHDR" "$URL")
  TOTAL=$((TOTAL + 1))
  if [ "$CODE" != "200" ]; then
    FAILED=$((FAILED + 1))
    echo "requete $TOTAL : code $CODE"
  fi
  sleep 0.1
done

echo "Total : $TOTAL requetes, $FAILED echouees (code != 200)"

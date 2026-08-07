#!/usr/bin/env bash
# Mesure ce qu'une livraison coute vraiment, vu du dehors.
#
# Le carnet demande, pour chaque facon de livrer : combien de carres se sont
# eteints, combien de coups ont ete perdus, et combien de temps ca a dure.
#
# Le statut healthy de Docker ne repond pas a cette question. Un conteneur passe
# en "health: starting" pendant son start_period alors qu'il repond deja, et il
# reste "healthy" plusieurs secondes apres avoir cesse de repondre. Ce qui compte
# est ce que voit quelqu'un qui frappe a la porte, donc on frappe.
#
#   ./scripts/mesure-interruption.sh [duree_en_secondes]
#
# A lancer AVANT le push, dans un autre terminal. Il sonde le front deux fois par
# seconde et compte les echecs.
set -uo pipefail

DUREE="${1:-180}"
URL="${URL_FRONT:-http://127.0.0.1:13000/sante}"

DEBUT=$(date +%s)
TOTAL=0
ECHECS=0
PREMIER_ECHEC=""
DERNIER_ECHEC=""

echo "sondage de $URL pendant ${DUREE}s, deux fois par seconde"

while [ $(( $(date +%s) - DEBUT )) -lt "$DUREE" ]; do
  TOTAL=$((TOTAL + 1))
  if curl -s -f -m 2 -o /dev/null "$URL"; then
    :
  else
    ECHECS=$((ECHECS + 1))
    MAINTENANT=$(( $(date +%s) - DEBUT ))
    [ -z "$PREMIER_ECHEC" ] && PREMIER_ECHEC=$MAINTENANT && echo "  premiere absence a t+${MAINTENANT}s"
    DERNIER_ECHEC=$MAINTENANT
  fi
  sleep 0.5
done

echo
echo "sondes            : $TOTAL"
echo "sans reponse      : $ECHECS"
if [ "$ECHECS" -gt 0 ]; then
  echo "duree d'absence   : environ $(( DERNIER_ECHEC - PREMIER_ECHEC + 1 )) s"
  echo "taux de reussite  : $(awk "BEGIN{printf \"%.1f\", (1-$ECHECS/$TOTAL)*100}") %"
else
  echo "duree d'absence   : aucune, le service a repondu a chaque sonde"
  echo "taux de reussite  : 100 %"
fi

#!/usr/bin/env bash
#
# charge.sh — un peu de trafic sur l'API deployee, le temps de voir bouger
# les panneaux.
#
#   ./scripts/charge.sh 120     pendant 120 secondes (defaut : 60)
#
# Sans trafic, les quatre panneaux affichent une ligne plate et on ne sait pas
# si c'est parce que tout va bien ou parce que rien ne fonctionne. C'est
# d'ailleurs la premiere chose a se demander devant un tableau de bord vide.
set -euo pipefail

API=${API:-http://127.0.0.1:13000}
DUREE=${1:-60}
FIN=$(( $(date +%s) + DUREE ))

echo "Charge sur $API pendant ${DUREE}s (Ctrl-C pour arreter plus tot)"

while [ "$(date +%s)" -lt "$FIN" ]; do
  curl -s "$API/api/tasks" > /dev/null
  curl -s -X POST "$API/api/tasks" \
    -H 'Content-Type: application/json' \
    -d '{"description":"charge","status":"todo"}' > /dev/null
  # Une route qui n'existe pas, pour peupler le panneau des erreurs. Sans
  # elle, le panneau reste desesperement vide et on ne saurait pas s'il
  # fonctionne — un panneau qu'on n'a jamais vu s'allumer n'est pas un panneau
  # sur lequel on peut compter pendant une panne.
  curl -s "$API/api/tasks/inexistant" > /dev/null
  sleep 0.2
done

echo "Fin de la charge."

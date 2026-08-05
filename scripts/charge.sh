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
#
# CORRIGE APRES LE PREMIER INCIDENT (phase 10). La version d'avant portait
# `set -e` et mourait au premier curl en echec, c'est-a-dire a la seconde meme
# ou la panne commencait. Le panneau Trafic tombait alors a zero pour deux
# raisons melangees — plus personne n'appelle, ET l'API ne repond plus — sans
# qu'on puisse les distinguer.
#
# De vrais utilisateurs, eux, continuent d'appeler pendant une panne. C'est
# meme ce qui rend le panneau Erreurs lisible. Le generateur de charge doit
# donc survivre a l'echec de sa cible : `set -e` retire, et chaque curl
# neutralise par `|| true`.
set -uo pipefail

API=${API:-http://127.0.0.1:13000}
DUREE=${1:-60}
FIN=$(( $(date +%s) + DUREE ))

echo "Charge sur $API pendant ${DUREE}s (Ctrl-C pour arreter plus tot)"

while [ "$(date +%s)" -lt "$FIN" ]; do
  # -m 3 : sans delai maximum, un curl reste pendu sur une cible qui ne repond
  # plus, et le "trafic" s'arrete de lui-meme au pire moment.
  curl -s -m 3 "$API/api/tasks" > /dev/null || true
  curl -s -m 3 -X POST "$API/api/tasks" \
    -H 'Content-Type: application/json' \
    -d '{"description":"charge","status":"todo"}' > /dev/null || true
  # Une route qui n'existe pas, pour peupler le panneau des erreurs. Sans
  # elle, le panneau reste desesperement vide et on ne saurait pas s'il
  # fonctionne — un panneau qu'on n'a jamais vu s'allumer n'est pas un panneau
  # sur lequel on peut compter pendant une panne.
  curl -s -m 3 "$API/api/tasks/inexistant" > /dev/null || true
  sleep 0.2
done

echo "Fin de la charge."

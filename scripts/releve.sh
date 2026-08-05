#!/usr/bin/env bash
#
# releve.sh — interroge Prometheus et sort une ligne du tableau de relevés.
#
#   ./scripts/releve.sh "Au repos"
#   ./scripts/releve.sh "Pendant la boucle de charge"
#
# Les quatre memes questions que les quatre premiers panneaux du tableau de
# bord, en ligne de commande. Deux raisons de l'avoir en script :
#
#   - le Journal de bord demande des chiffres, pas des captures d'ecran, et
#     recopier un chiffre lu sur un graphique est le meilleur moyen de se
#     tromper d'un facteur dix
#   - pendant une astreinte, le tableau de bord peut etre celui de quelqu'un
#     d'autre, ou ne pas s'ouvrir. Ces quatre requetes PromQL tiennent dans un
#     terminal et repondent quand meme.
set -euo pipefail

PROM=${PROM:-http://127.0.0.1:19090}
MOMENT=${1:-$(date -u +'%H:%M:%S UTC')}

# Interroge Prometheus et renvoie la premiere valeur, ou "-" si la requete ne
# renvoie rien (cas normal : un taux d'erreur n'existe pas quand aucune requete
# n'arrive — une division par zero n'a pas de valeur, et afficher 0 % ferait
# croire que tout va bien alors que plus personne n'appelle).
q() {
  curl -sg --data-urlencode "query=$1" "$PROM/api/v1/query" |
    python3 -c "
import json,sys
r = json.load(sys.stdin).get('data', {}).get('result', [])
print(f\"{float(r[0]['value'][1]):.3f}\" if r else '-')
"
}

UP=$(q 'up{job="todo-api"}')
RPS=$(q 'sum(rate(http_requests_total{route!="/metrics"}[1m]))')
ERR=$(q '100 * (sum(rate(http_requests_total{status=~"5.."}[1m])) or vector(0)) / sum(rate(http_requests_total[1m]))')
P95=$(q 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route!="/metrics"}[1m])) by (le))')

printf '| %-34s | %-4s | %-10s | %-13s | %-8s |\n' \
  "$MOMENT" "$UP" "$RPS" "$ERR" "$P95"

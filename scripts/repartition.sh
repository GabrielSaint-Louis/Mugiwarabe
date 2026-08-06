#!/bin/sh
#
# repartition.sh — combien de requetes chaque pod a-t-il VRAIMENT vues.
#
#   ./scripts/repartition.sh
#
# Le point de la manoeuvre : interroger chaque pod directement, en contournant
# le Service. Passer par le Service pour verifier que le Service repartit le
# trafic reviendrait a se demander a soi-meme si on dit la verite. Un
# port-forward par pod, un /metrics lu a la source, et le compteur de chacun.
NS="${NS:-todo}"
# 33001 et pas 3001 : sur cette machine, 3000 et 3001 sont deja pris par un
# autre site. Un port-forward qui echoue sur "address already in use" affiche
# trois pods sans le moindre chiffre, ce qui se lit a tort comme "aucun pod ne
# recoit rien".
PORT="${PORT:-33001}"

for pod in $(kubectl get pods -n "$NS" -l app=todo-api -o name); do
  kubectl port-forward -n "$NS" "$pod" "${PORT}:3000" >/dev/null 2>&1 &
  PF_PID=$!
  sleep 1
  # Le nom court du pod suffit a la lecture, le prefixe pod/ n'apporte rien.
  echo "== ${pod#pod/} =="
  # Un pod qui n'a jamais rien servi n'expose PAS http_requests_total a zero :
  # prom-client ne cree la serie qu'a la premiere observation. Sans ce
  # message, l'absence de ligne se lit comme un bug du script.
  curl -s "localhost:${PORT}/metrics" | grep '^http_requests_total' | sed 's/^/   /' \
    || echo "   (aucune requete comptee sur ce pod)"
  kill "$PF_PID" 2>/dev/null
  wait "$PF_PID" 2>/dev/null
done

exit 0

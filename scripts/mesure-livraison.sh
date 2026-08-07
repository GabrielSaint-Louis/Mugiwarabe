#!/usr/bin/env bash
# Chronometre une livraison, du push jusqu'au dernier service a jour.
#
# Le carnet de la flotte demande la duree entre le push et le dernier carre a
# jour. Ce chiffre ne se devine pas : entre le declenchement du workflow, la
# construction de quatre images, la publication et le remplacement, il y a assez
# d'etapes pour se tromper d'un facteur trois.
#
#   ./scripts/mesure-livraison.sh <sha attendu>
#
# On interroge la machine cible plutot que le statut de la pipeline : ce qui
# compte, c'est le moment ou les services declarent la nouvelle version, pas le
# moment ou GitHub affiche une coche verte.
set -uo pipefail

SHA="${1:?usage: mesure-livraison.sh <sha>}"
CLE="${DEPLOY_KEY_PATH:-$HOME/tp-devops-todo-api/deploy/deploy_key}"
SSH="ssh -i $CLE -p 2222 -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@localhost"
SERVICES=(front api classement vigie)

DEBUT=$(date +%s)
declare -A VU

echo "on attend le sha ${SHA:0:7} sur les quatre services"

while true; do
  RESTE=0
  for SERVICE in "${SERVICES[@]}"; do
    [ -n "${VU[$SERVICE]:-}" ] && continue

    VERSION=$($SSH "cd /srv/flotte && docker compose -f compose.prod.yml exec -T $SERVICE \
      node -e \"require('http').get('http://127.0.0.1:3000/sante', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { console.log(JSON.parse(d).version) } catch { console.log('') } }) }).on('error',()=>console.log(''))\"" 2>/dev/null | tr -d '\r')

    if [ "$VERSION" = "$SHA" ]; then
      VU[$SERVICE]=$(( $(date +%s) - DEBUT ))
      echo "  $SERVICE a jour apres ${VU[$SERVICE]} s"
    else
      RESTE=1
    fi
  done

  [ "$RESTE" -eq 0 ] && break

  if [ $(( $(date +%s) - DEBUT )) -gt 600 ]; then
    echo "  abandon au bout de dix minutes"
    for SERVICE in "${SERVICES[@]}"; do
      [ -z "${VU[$SERVICE]:-}" ] && echo "  $SERVICE n'est jamais passe a jour"
    done
    exit 1
  fi
  sleep 3
done

echo
echo "dernier service a jour apres $(( $(date +%s) - DEBUT )) secondes"

#!/usr/bin/env bash
#
# vm-prod.sh : construit et demarre la machine cible du jour 3.
#
# Un script plutot qu'une ligne de README parce que la phase 9 en a besoin :
# une procedure de deploiement se lit a 3h du matin, et personne ne veut y
# retrouver quatre options -p a recopier a la main sans se tromper.
#
#   ./deploy/vm-prod.sh up       construit l'image et demarre la machine
#   ./deploy/vm-prod.sh down     arrete et supprime la machine (le volume reste)
#   ./deploy/vm-prod.sh ssh      ouvre un shell dessus
#   ./deploy/vm-prod.sh status   dit si elle repond
#
set -euo pipefail

cd "$(dirname "$0")"

NAME=vm-prod
KEY=deploy_key

# --- Les ports, et pourquoi ce ne sont pas ceux du TP -------------------------
# Le TP publie 3000, 9090 et 3001 tels quels. Sur CETTE machine, 3000 et 3001
# sont deja pris par le site en production (backend pm2 et son front Next.js) :
# un `docker run -p 3000:3000` echouerait sur un "port is already allocated",
# et s'il reussissait il masquerait un site vivant. On decale donc cote hote.
# A l'interieur de la machine cible, rien ne change : l'API ecoute bien sur
# 3000, Prometheus sur 9090, Grafana sur 3001.
#
# Tout est publie sur 127.0.0.1 et pas sur 0.0.0.0 : ce serveur est expose sur
# Internet, et ni un sshd root ni un Grafana en admin/admin n'ont a y etre
# joignables. Pour ouvrir Grafana depuis un navigateur, on passe par un tunnel :
#
#   ssh -L 3001:127.0.0.1:13001 <ce-serveur>   puis http://localhost:3001
#
SSH_PORT=2222
API_PORT=13000
PROM_PORT=19090
GRAFANA_PORT=13001

ssh_cible() {
  ssh -i "$KEY" -p "$SSH_PORT" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o LogLevel=ERROR \
      root@127.0.0.1 "$@"
}

case "${1:-up}" in
  up)
    if [ ! -f "$KEY" ]; then
      echo "Cle absente. La generer d'abord, depuis la racine du depot :" >&2
      echo '  ssh-keygen -t ed25519 -N "" -f deploy/deploy_key' >&2
      exit 1
    fi

    docker build -f Dockerfile.vm -t "$NAME" .

    docker rm -f "$NAME" >/dev/null 2>&1 || true

    # --privileged : necessaire pour qu'un Docker tourne dans un conteneur.
    # C'est aussi pour ca qu'on ne fait jamais ca sur une vraie prod.
    #
    # Le volume vm-prod-data garde images et conteneurs de la machine cible
    # entre deux redemarrages : sans lui, tout serait a retelecharger.
    docker run -d --privileged --name "$NAME" \
      -p "127.0.0.1:$SSH_PORT:22" \
      -p "127.0.0.1:$API_PORT:3000" \
      -p "127.0.0.1:$PROM_PORT:9090" \
      -p "127.0.0.1:$GRAFANA_PORT:3001" \
      -v vm-prod-data:/var/lib/docker \
      "$NAME"

    printf 'Demarrage du daemon Docker de la cible '
    until ssh_cible 'docker info' >/dev/null 2>&1; do
      printf '.'
      sleep 2
    done
    echo ' pret.'

    echo "SSH      : ssh -i deploy/$KEY -p $SSH_PORT root@127.0.0.1"
    echo "API      : http://127.0.0.1:$API_PORT/health"
    echo "Prom     : http://127.0.0.1:$PROM_PORT"
    echo "Grafana  : http://127.0.0.1:$GRAFANA_PORT"
    ;;

  down)
    docker rm -f "$NAME"
    echo "Machine supprimee. Le volume vm-prod-data est conserve :"
    echo "  docker volume rm vm-prod-data   pour repartir de zero"
    ;;

  ssh)
    shift || true
    ssh_cible "$@"
    ;;

  status)
    echo -n "conteneur : "
    docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo absent
    echo -n "ssh       : "
    if ssh_cible true >/dev/null 2>&1; then echo ok; else echo injoignable; fi
    echo -n "api       : "
    curl -sf "http://127.0.0.1:$API_PORT/health" || echo "pas de reponse"
    echo
    ;;

  *)
    echo "usage : $0 {up|down|ssh|status}" >&2
    exit 1
    ;;
esac

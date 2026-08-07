#!/usr/bin/env bash
# Ouvre le front de la flotte sur une URL publique, pour que la classe puisse
# jouer depuis son telephone.
#
# La machine cible vit derriere le reseau de l'ecole, sans adresse publique.
# C'est le meme mur que celui qui impose au pouls de partir de nos services vers
# le tableau : une machine exterieure ne peut pas ouvrir de connexion vers un
# poste. Le tunnel contourne ca dans le seul sens qui passe partout, en sortant
# de chez nous.
#
#   ./scripts/tunnel.sh
#
# L'adresse change a chaque demarrage. Elle s'affiche ici, et il faut la
# redonner a la classe si le tunnel est relance.
set -uo pipefail

PORT="${PORT_FRONT_HOTE:-13000}"
JOURNAL="${TMPDIR:-/tmp}/tunnel-mugiwarabe.log"

command -v cloudflared >/dev/null || {
  echo "cloudflared est absent. Installation :"
  echo "  curl -sL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  echo "  chmod +x ~/.local/bin/cloudflared"
  exit 1
}

curl -s -f -m 3 -o /dev/null "http://127.0.0.1:$PORT/sante" || {
  echo "Le front ne repond pas sur le port $PORT. Montez la flotte avant d'ouvrir le tunnel."
  exit 1
}

echo "ouverture du tunnel vers http://127.0.0.1:$PORT"
nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > "$JOURNAL" 2>&1 &

for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$JOURNAL" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 2
done

if [ -z "${URL:-}" ]; then
  echo "aucune adresse obtenue, voir $JOURNAL"
  exit 1
fi

echo
echo "  La classe joue ici : $URL"
echo
echo "  verification : HTTP $(curl -s -o /dev/null -w '%{http_code}' -L "$URL/")"

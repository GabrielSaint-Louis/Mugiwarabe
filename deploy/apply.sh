#!/bin/sh
#
# apply.sh — la commande de deploiement, et la commande de retour arriere.
# Elle vit SUR la machine cible, dans /srv/todo, envoyee par la pipeline.
#
#   ./apply.sh <sha>     deploie (ou revient a) cette version
#   ./apply.sh           redeploie la version actuelle, telle qu'elle est
#
# Pourquoi un script plutot que la ligne du TP, `TAG=<sha> docker compose up -d` ?
#
# Parce que le TAG passe en variable d'environnement ne vit que le temps de la
# commande. Toutes les commandes de LECTURE qui suivent — docker compose ps,
# docker compose logs, celles qu'on tape justement pendant une panne — se
# heurtent alors au garde `${TAG:?}` du compose.yml et refusent de repondre.
# On l'a decouvert en le vivant, cinq minutes apres avoir deploye la
# surveillance.
#
# Ici, le sha est ECRIT dans le .env. Il devient donc l'etat courant de la
# machine, lisible par toutes les commandes suivantes, et consultable pour
# repondre a la seule question qui compte en debut d'astreinte : quelle
# version tourne, la ?
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Pas de .env dans $(pwd). Il se pose une fois a la main, il ne vient" >&2
  echo "jamais du depot. Modele : deploy/env.example" >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  NOUVEAU="$1"

  # Le sha est ecrit dans le .env avant toute autre chose : si le pull echoue
  # juste apres, la trace de ce qu'on a TENTE de deployer reste sur la machine.
  if grep -q '^TAG=' .env; then
    sed -i "s|^TAG=.*|TAG=$NOUVEAU|" .env
  else
    printf '\n# Version deployee. Ecrite par apply.sh, pas a la main.\nTAG=%s\n' "$NOUVEAU" >> .env
  fi
fi

TAG_COURANT=$(grep '^TAG=' .env | cut -d= -f2)
echo "Version visee : $TAG_COURANT"

# `pull` avant `up` : si l'image n'existe pas sur le registry — un sha mal
# recopie, un retour arriere vers une version jamais publiee — on echoue ICI,
# sur un "manifest unknown" lisible, pendant que l'ancienne version tourne
# toujours. Sans cette etape, l'echec arriverait au milieu de la recreation du
# conteneur, avec la production a moitie eteinte.
docker compose pull todo-api

# up -d compare l'etat voulu a l'etat reel et ne touche que ce qui a change.
# Rejouee dix fois de suite, cette commande laisse un seul conteneur todo-api,
# toujours a jour, la ou une sequence de docker run planterait sur un nom deja
# pris des le deuxieme passage.
docker compose up -d --remove-orphans

echo
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

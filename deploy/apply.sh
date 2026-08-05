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
#
# Et il n'y est ecrit qu'APRES un telechargement reussi, jamais avant. C'est ce
# qui fait que ce fichier ne peut pas mentir a celui qui le lit pendant une
# panne. Le pourquoi est plus bas, a l'endroit ou l'ordre se joue.
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Pas de .env dans $(pwd). Il se pose une fois a la main, il ne vient" >&2
  echo "jamais du depot. Modele : deploy/env.example" >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  NOUVEAU="$1"
  echo "Version visee : $NOUVEAU"

  # ON TELECHARGE AVANT D'ECRIRE QUOI QUE CE SOIT.
  #
  # La premiere version de ce script ecrivait le sha dans le .env d'abord, pour
  # "garder la trace de ce qu'on a tente". Mauvaise idee, decouverte en s'en
  # servant : un retour arriere vers une version jamais publiee a echoue au
  # pull, et le .env affichait alors une version qui ne tournait pas. Or c'est
  # ce fichier que la procedure fait lire pour repondre a "quelle version
  # tourne ?". Un fichier qui ment pendant une panne est pire que pas de
  # fichier du tout.
  #
  # Le TAG passe ici en variable d'environnement : il gagne sur celui du .env
  # le temps de cette commande, sans le modifier. Si l'image n'existe pas, on
  # echoue sur un "manifest unknown" lisible pendant que l'ancienne version
  # tourne toujours, et le .env n'a pas bouge.
  if ! TAG="$NOUVEAU" docker compose pull todo-api; then
    echo >&2
    echo "L'image de cette version n'existe pas sur le registry." >&2
    echo >&2
    echo "Attention : tous les commits de main n'ont pas d'image. Seuls les" >&2
    echo "commits FUSIONNES en ont une, les commits de branche sont construits" >&2
    echo "sans etre publies. La liste des versions deployables :" >&2
    echo "    git log --first-parent --format='%H  %s' main" >&2
    echo >&2
    echo "Rien n'a ete change. La version en place continue de tourner." >&2
    exit 1
  fi

  # Le pull a reussi, donc l'image existe : on peut persister le choix.
  if grep -q '^TAG=' .env; then
    sed -i "s|^TAG=.*|TAG=$NOUVEAU|" .env
  else
    printf '\n# Version deployee. Ecrite par apply.sh, pas a la main.\nTAG=%s\n' "$NOUVEAU" >> .env
  fi
else
  # Sans argument (un simple `./apply.sh`), on redeploie la version courante :
  # aucun pull n'a eu lieu plus haut, il se fait ici. Le `else` compte — sinon
  # le cas avec argument telechargerait deux fois la meme image.
  docker compose pull todo-api
fi

TAG_COURANT=$(grep '^TAG=' .env | cut -d= -f2)
echo "Version appliquee : $TAG_COURANT"

# up -d compare l'etat voulu a l'etat reel et ne touche que ce qui a change.
# Rejouee dix fois de suite, cette commande laisse un seul conteneur todo-api,
# toujours a jour, la ou une sequence de docker run planterait sur un nom deja
# pris des le deuxieme passage.
docker compose up -d --remove-orphans

echo
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

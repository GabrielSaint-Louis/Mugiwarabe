#!/bin/sh
#
# incident.sh — a lancer SUR la machine cible, SANS REGARDER LE RESULTAT.
#
#   ssh -i deploy/deploy_key -p 2222 root@127.0.0.1 'sh -s' < deploy/incident.sh
#
# Le script tire une panne au hasard parmi cinq et n'affiche rien. Le lire a
# l'avance ne donne aucun avantage : connaitre la liste des pannes possibles,
# c'est exactement la situation d'une vraie astreinte. Toute la difficulte
# reste de reconnaitre laquelle est en train de se produire, et le tableau de
# bord repond a cette question plus vite que la lecture de ce fichier.
#
# La reponse est ecrite dans /root/.incident, encodee, pour le debriefing
# seulement :
#     base64 -d /root/.incident
set -u

N=$(( $(od -An -N1 -tu1 /dev/urandom) % 5 + 1 ))
echo "$N" | base64 > /root/.incident

IMAGE=$(docker inspect -f '{{.Config.Image}}' todo-api)

case "$N" in
  1)
    # Plus personne ne repond.
    docker stop todo-api
    ;;

  2)
    # L'API repond, la base a disparu.
    docker stop todo-db
    ;;

  3)
    # La base tourne, mais l'API ne la joint plus.
    NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' todo-api | awk '{print $1}')
    docker network disconnect "$NET" todo-api
    ;;

  4)
    # Relancee sans sa configuration, comme le ferait quelqu'un qui "repare"
    # a la main un vendredi soir.
    docker rm -f todo-api
    docker run -d --name todo-api -p 3000:3000 "$IMAGE"
    ;;

  5)
    # La machine ne respire plus.
    #
    # ECART ASSUME PAR RAPPORT AU TP : chaque parasite est bride a un quart de
    # coeur (--cpus 0.25) au lieu de tourner sans limite. Cette machine cible
    # est un conteneur, et le CPU qu'il brule est celui du serveur hote, qui
    # heberge un vrai site en production a cote. Quatre boucles infinies sans
    # bride le feraient tomber avec l'exercice.
    #
    # La signature reste la meme — le p95 s'envole, le trafic s'effondre — et
    # c'est elle qu'on apprend a reconnaitre, pas la valeur exacte de la
    # charge.
    for i in 1 2 3 4; do
      docker run -d --cpus 0.25 --name hog-$i alpine sh -c 'while :; do :; done'
    done
    ;;
esac

#!/usr/bin/env bash
# pannes.sh : tire une panne au hasard et l'applique sur la machine cible.
#
# A lancer depuis un poste, la machine cible doit etre joignable en SSH.
# Personne dans l'equipage ne regarde le numero qui sort, c'est tout l'interet :
# on lit ce qui se passe au tableau et sur les panneaux, on nomme la panne, et on
# verifie seulement apres.
#
#   ./pannes.sh          tire une panne au hasard
#   ./pannes.sh 3        joue la panne numero 3, pour repeter une manoeuvre
#   ./pannes.sh --reparer  remet tout d'aplomb apres coup
#
# Le numero tire est ecrit dans .incident, qui n'est pas versionne : le committer
# reviendrait a publier le corrige avec l'exercice.
set -u

CLE="${DEPLOY_KEY_PATH:-$HOME/tp-devops-todo-api/deploy/deploy_key}"
CIBLE="ssh -i $CLE -p 2222 -o StrictHostKeyChecking=no root@localhost"
DOSSIER=/srv/flotte
SERVICES=(front api classement vigie)

# --- La remise en etat -------------------------------------------------------
# Elle est ici plutot que dans un second script parce qu'elle doit rester a jour
# avec les pannes : une panne qu'on ne sait pas defaire est une panne qu'on ne
# rejouera pas, et le sujet demande de toutes les tirer au moins une fois.
if [ "${1:-}" = "--reparer" ]; then
  echo "remise en etat de la flotte"
  $CIBLE "cd $DOSSIER && sed -i 's|^TAG=.*|TAG=$(git -C "$(dirname "$0")" rev-parse main)|' .env"
  $CIBLE "cd $DOSSIER && sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=REMPLACER|' .env"
  echo "  attention : le mot de passe doit etre remis depuis les secrets, par la pipeline."
  echo "  relancez le workflow plutot que de le taper a la main."
  $CIBLE "cd $DOSSIER && docker compose -f compose.prod.yml exec -T api chmod 755 /data 2>/dev/null"
  exit 0
fi

VICTIME=${SERVICES[$RANDOM % ${#SERVICES[@]}]}
PANNE=${1:-$((RANDOM % 6))}
echo "$PANNE" > "$(dirname "$0")/.incident"

case $PANNE in
  # 1. Le conteneur tue. La politique de redemarrage decide de la suite : avec
  #    unless-stopped, docker le relance, et le carre revient tout seul.
  0) $CIBLE "cd $DOSSIER && docker compose -f compose.prod.yml kill $VICTIME" ;;

  # 2. La base coupee. Rien n'est casse dans l'API, sa dependance a disparu.
  1) $CIBLE "cd $DOSSIER && docker compose -f compose.prod.yml stop db" ;;

  # 3. Le pavillon muet. Le dossier du volume n'est plus lisible, le service
  #    tourne pourtant tres bien.
  2) $CIBLE "cd $DOSSIER && docker compose -f compose.prod.yml exec -T api chmod 000 /data" ;;

  # 4. Le secret efface. La configuration est incomplete, l'image est intacte.
  3) $CIBLE "cd $DOSSIER && sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=|' .env && docker compose -f compose.prod.yml up -d api" ;;

  # 5. La version introuvable. Le tag demande n'existe pas sur le registry.
  4) $CIBLE "cd $DOSSIER && sed -i 's|^TAG=.*|TAG=nexistepas|' .env && docker compose -f compose.prod.yml up -d $VICTIME" ;;

  # 6. Le tableau injoignable. Rien du tout n'est casse, sauf le chemin entre le
  #    service et le tableau. La plus retorse des six.
  5) $CIBLE "cd $DOSSIER && sed -i 's|^TABLEAU_URL=.*|TABLEAU_URL=http://127.0.0.1:1|' .env && docker compose -f compose.prod.yml up -d $VICTIME" ;;

  *) echo "panne inconnue : $PANNE" ; exit 1 ;;
esac

echo "Le tableau va parler. Qu'est-ce qui s'est eteint, et pourquoi ?"

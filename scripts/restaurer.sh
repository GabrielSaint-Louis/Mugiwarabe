#!/bin/sh
#
# restaurer.sh — remettre la base dans l'etat d'une sauvegarde.
#
#   ./scripts/restaurer.sh                 liste les sauvegardes disponibles
#   ./scripts/restaurer.sh <fichier>       restaure celle-la
#
# UNE SAUVEGARDE JAMAIS RESTAUREE N'EST PAS UNE SAUVEGARDE. Ce script existe
# pour que la restauration soit un geste teste, pas une improvisation le jour ou
# elle sert. Il est joue au moins une fois a chaque fois qu'on touche au
# CronJob, et le resultat est note au Journal de bord.
set -eu

NS="${NS:-todo}"
FICHIER="${1:-}"

# Le pod du CronJob ne tourne que six heures sur six heures : on monte la PVC
# des sauvegardes dans un pod ephemere pour la lire. La PVC est ReadWriteOnce,
# donc ce pod ne peut exister que si aucun job de sauvegarde ne tourne.
lister() {
  kubectl -n "$NS" run lecteur-sauvegardes --rm -i --restart=Never \
    --image=postgres:16-alpine \
    --overrides='{"spec":{"containers":[{"name":"lecteur-sauvegardes","image":"postgres:16-alpine","command":["ls","-lht","/sauvegardes"],"volumeMounts":[{"name":"s","mountPath":"/sauvegardes"}]}],"volumes":[{"name":"s","persistentVolumeClaim":{"claimName":"todo-db-sauvegardes"}}]}}' \
    2>/dev/null
}

if [ -z "$FICHIER" ]; then
  echo "Sauvegardes disponibles :"
  lister
  echo
  echo "Pour en restaurer une :  $0 <nom-du-fichier>"
  exit 0
fi

cat <<AVERTISSEMENT
=============================================================================
 CE QUI VA SE PASSER, et il n'y a pas de retour arriere :

   1. le contenu actuel de la table tasks est ECRASE
   2. par l'etat fige dans $FICHIER

 Tout ce qui a ete cree depuis cette sauvegarde sera perdu. Si le doute
 existe, lancez d'abord un dump du present :
     kubectl -n $NS create job --from=cronjob/todo-db-sauvegarde avant-restauration
=============================================================================
AVERTISSEMENT

printf 'Taper RESTAURER pour continuer : '
read -r reponse
[ "$reponse" = "RESTAURER" ] || { echo "Annule, rien n'a ete touche."; exit 1; }

echo "== restauration de $FICHIER =="
kubectl -n "$NS" run restauration --rm -i --restart=Never \
  --image=postgres:16-alpine \
  --env=PGHOST=todo-db \
  --overrides="$(cat <<JSON
{"spec":{"containers":[{
  "name":"restauration","image":"postgres:16-alpine",
  "command":["/bin/sh","-c","set -eu; gunzip -c /sauvegardes/$FICHIER | psql -v ON_ERROR_STOP=1 && echo RESTAURATION_OK"],
  "env":[
    {"name":"PGHOST","value":"todo-db"},
    {"name":"PGDATABASE","valueFrom":{"secretKeyRef":{"name":"todo-secret","key":"DB_NAME"}}},
    {"name":"PGUSER","valueFrom":{"secretKeyRef":{"name":"todo-secret","key":"DB_USER"}}},
    {"name":"PGPASSWORD","valueFrom":{"secretKeyRef":{"name":"todo-secret","key":"DB_PASSWORD"}}}
  ],
  "volumeMounts":[{"name":"s","mountPath":"/sauvegardes"}]}],
 "volumes":[{"name":"s","persistentVolumeClaim":{"claimName":"todo-db-sauvegardes"}}]}}
JSON
)"

echo
echo "Verification : les taches presentes maintenant"
curl -s -H "Host: todo.localhost" http://127.0.0.1:8080/api/tasks | head -c 300
echo

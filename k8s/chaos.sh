#!/bin/sh
#
# chaos.sh : tire une panne au hasard parmi cinq, sur todo-cluster.
#
#   ./k8s/chaos.sh          declenche une panne, et n'affiche rien
#   base64 -d .incident     donne le numero tire, APRES le diagnostic
#
# A lancer depuis votre poste, kubectl doit deja pointer sur todo-cluster.
#
# Le script n'affiche rien de ce qu'il vient de faire : le sujet, c'est le
# diagnostic, pas la surprise. Le lire a l'avance ne triche pas — la difficulte
# reste de reconnaitre laquelle des cinq est en train de se produire a partir
# d'un kubectl get pods et d'un kubectl describe.
#
# Suite de l'incident.sh du jour 3, meme principe, cible differente : hier les
# cinq pannes touchaient des conteneurs sur une machine, aujourd'hui elles
# touchent des objets d'un cluster. Deux d'entre elles se reparent toutes
# seules, trois attendent une main humaine, et c'est tout l'objet du tableau de
# la section correspondante de docs/PROCEDURE_DEPLOIEMENT.md.
N=$(( $(od -An -N1 -tu1 /dev/urandom) % 5 + 1 ))
echo "$N" | base64 > .incident            # la reponse, pour le debriefing seulement

POD=$(kubectl get pods -n todo -l app=todo-api -o jsonpath='{.items[0].metadata.name}')
IMAGE=$(kubectl get deployment todo-api -n todo -o jsonpath='{.spec.template.spec.containers[0].image}')
REPO="${IMAGE%%:*}"

case "$N" in
  1) kubectl delete pod -n todo "$POD" ;;                                  # un pod disparait
  2) kubectl exec -n todo "$POD" -- kill 1 ;;                              # le processus meurt dans le conteneur
  3) kubectl set image deployment/todo-api todo-api="${REPO}:ce-tag-n-existe-pas" -n todo ;;   # l'image ciblee n'existe nulle part
  4) kubectl patch secret todo-secret -n todo --type=json \
       -p='[{"op":"remove","path":"/data/DB_PASSWORD"}]'
     kubectl rollout restart deployment/todo-api -n todo ;;                # l'appli redemarre sans un secret qu'elle exige
  5) kubectl patch deployment todo-api -n todo --type=json \
       -p='[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"limits":{"memory":"8Mi"}}}]' ;;  # la limite memoire ne laisse plus l'appli demarrer
esac >/dev/null 2>&1

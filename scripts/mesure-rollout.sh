#!/bin/bash
#
# mesure-rollout.sh — un rolling update sous charge, chronometre et compte.
#
#   ./scripts/mesure-rollout.sh <tag-image>
#
# Ce que ce script produit, et qui va directement dans le Journal de bord :
# le nombre de requetes echouees pendant la mise a jour, les secondes
# d'indisponibilite qui s'en deduisent, et le temps de convergence total.
#
# Le protocole est celui du TP, automatise pour etre rejouable a l'identique :
# une intuition ne se compare pas d'un jour a l'autre, un chiffre si.
set -uo pipefail

TAG="${1:?usage: mesure-rollout.sh <tag-image>}"
IMAGE="${IMAGE:-ghcr.io/gabrielsaint-louis/todo-api}"
NS="${NS:-todo}"
DUREE="${DUREE:-45}"
# Un echec dure au maximum un tour de boucle de charge-cluster.sh, soit son
# sleep 0.1 plus le temps du curl. On approxime a 0,1 s par requete perdue :
# c'est une borne basse, annoncee comme telle plutot que maquillee.
PAS=0.1

SORTIE=$(mktemp)

# CORRIGE APRES LA TROISIEME MESURE. Sans cette attente, la charge demarrait
# pendant que les pods du rollout PRECEDENT finissaient de mourir, et leurs
# echecs etaient comptes au debit du rollout qu'on mesure. Trois requetes
# perdues attribuees a la mauvaise cause, ce qui est pire que pas de mesure.
echo "== on attend que le cluster soit au repos =="
for _ in $(seq 1 60); do
  ATTENDUS=$(kubectl -n "$NS" get deployment todo-api -o jsonpath='{.spec.replicas}')
  VIVANTS=$(kubectl -n "$NS" get pods -l app=todo-api --no-headers | wc -l)
  PRETS=$(kubectl -n "$NS" get deployment todo-api -o jsonpath='{.status.readyReplicas}')
  # Autant de pods vivants que voulus, tous prets, et surtout AUCUN en trop :
  # un pod Terminating est un pod qui peut encore faire echouer une requete.
  [ "$VIVANTS" = "$ATTENDUS" ] && [ "$PRETS" = "$ATTENDUS" ] && break
  sleep 2
done
echo "   $VIVANTS pod(s) vivant(s), $PRETS pret(s)"

echo "== charge en fond pendant ${DUREE}s =="
./scripts/charge-cluster.sh "$DUREE" > "$SORTIE" 2>&1 &
CHARGE_PID=$!
sleep 3

echo "== bascule vers $TAG =="
DEBUT=$(date +%s.%N)
kubectl -n "$NS" set image deployment/todo-api todo-api="${IMAGE}:${TAG}"
kubectl -n "$NS" rollout status deployment/todo-api --timeout=300s
FIN=$(date +%s.%N)

wait "$CHARGE_PID"

ECHECS=$(grep -oP 'requetes, \K[0-9]+' "$SORTIE")
TOTAL=$(grep -oP 'Total : \K[0-9]+' "$SORTIE")
CONV=$(echo "$FIN - $DEBUT" | bc)
INDISPO=$(echo "$ECHECS * $PAS" | bc)

echo
echo "---------------- resultat ----------------"
echo "Requetes emises              : $TOTAL"
echo "Requetes echouees            : $ECHECS"
echo "Indisponibilite (approchee)  : ${INDISPO}s"
printf "Convergence totale           : %.1fs\n" "$CONV"
echo "------------------------------------------"
grep -m5 'code' "$SORTIE" || true

rm -f "$SORTIE"

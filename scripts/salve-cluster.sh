#!/usr/bin/env bash
# Tire une salve sur la route de travail d'un service du cluster.
#
# Meme geste que scripts/salve.sh, mais sur les pods au lieu de la machine
# cible. Les deux existent parce que les deux mondes ne se mesurent pas pareil :
# sur le compose il y a un exemplaire par service, sur le cluster il y en a
# deux, et le Service repartit entre eux. Comparer les deux chiffres sans le
# savoir donnerait n'importe quoi.
#
#   ./scripts/salve-cluster.sh api 5000 500
#                              |    |    |
#                              |    |    coups en parallele
#                              |    nombre de coups
#                              service vise
#
# La salve part depuis un pod du front : il a de quoi appeler les autres par le
# DNS du cluster, et il n'est pas la cible, donc sa propre charge ne fausse pas
# la mesure. Passer par l'Ingress mesurerait aussi Traefik.
set -uo pipefail

SERVICE="${1:-api}"
COUPS="${2:-2000}"
PARALLELE="${3:-200}"
NS="${NAMESPACE:-mugiwarabe}"

POD=$(kubectl get pods -n "$NS" -l app=front -o name 2>/dev/null | head -1)
[ -z "$POD" ] && { echo "aucun pod front dans $NS"; exit 1; }

echo "salve de $COUPS coups sur $SERVICE, $PARALLELE en parallele"

kubectl exec -n "$NS" "$POD" -- node -e "
const cible = 'http://$SERVICE/travail';
const total = $COUPS, parallele = $PARALLELE;
let faits = 0, rates = 0;
const durees = [];
const debut = Date.now();

async function paquet(n) {
  await Promise.all(Array.from({length: n}, async () => {
    const t = Date.now();
    try {
      const r = await fetch(cible);
      if (r.ok) { faits++; durees.push(Date.now() - t); } else rates++;
    } catch { rates++; }
  }));
}

(async () => {
  for (let i = 0; i < total; i += parallele) {
    await paquet(Math.min(parallele, total - i));
  }
  const ecoule = (Date.now() - debut) / 1000;
  durees.sort((a, b) => a - b);
  const p = q => durees.length ? durees[Math.floor(durees.length * q)] : 0;
  console.log('  encaisses       : ' + faits + ' / ' + total);
  console.log('  rates           : ' + rates);
  console.log('  duree           : ' + ecoule.toFixed(2) + ' s');
  console.log('  debit           : ' + (faits / ecoule).toFixed(1) + ' coups/s');
  console.log('  latence mediane : ' + p(0.5) + ' ms');
  console.log('  latence p95     : ' + p(0.95) + ' ms');
})();
" 2>/dev/null

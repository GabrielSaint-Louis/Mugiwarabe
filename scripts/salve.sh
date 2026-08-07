#!/usr/bin/env bash
# Tire une salve sur la route de travail d'un service et mesure ce qu'il encaisse.
#
# Le tableau de la classe fait ca tout seul quand le feu est ouvert : il transmet
# les coups au pouls, qui les envoie par paquets de dix sur /travail. Ce script
# reproduit le meme geste depuis la machine cible, pour trouver le point de
# bascule avant que la classe ne le trouve pour nous.
#
#   ./scripts/salve.sh api 200 10
#                      |   |   |
#                      |   |   coups en parallele, comme le pouls
#                      |   nombre de coups
#                      service vise
#
# Il tourne DANS la flotte et pas depuis le poste : /travail n'est pas publie
# vers l'exterieur, et c'est voulu. Mesurer a travers un port publie mesurerait
# aussi la traversee du reseau de la machine, pas la capacite du service.
set -uo pipefail

SERVICE="${1:-api}"
COUPS="${2:-200}"
PARALLELE="${3:-10}"
CLE="${DEPLOY_KEY_PATH:-$HOME/tp-devops-todo-api/deploy/deploy_key}"
CIBLE="ssh -i $CLE -p 2222 -o StrictHostKeyChecking=no root@localhost"

echo "salve de $COUPS coups sur $SERVICE, $PARALLELE en parallele"

# On passe par le conteneur du front : il a de quoi appeler les autres sur le
# reseau interne, et il n'est pas la cible de la salve, donc sa propre charge ne
# fausse pas la mesure.
LECTURE=$($CIBLE "cd /srv/flotte && docker compose -f compose.prod.yml exec -T front node -e \"
const cible = 'http://$SERVICE:3000/travail';
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
  console.log(JSON.stringify({
    encaisses: faits,
    rates,
    secondes: Number(ecoule.toFixed(2)),
    par_seconde: Number((faits / ecoule).toFixed(1)),
    latence_mediane_ms: p(0.5),
    latence_p95_ms: p(0.95),
  }));
})();
\"" 2>/dev/null)

echo "$LECTURE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  encaisses          : {d['encaisses']} / $COUPS\")
print(f\"  rates              : {d['rates']}\")
print(f\"  duree              : {d['secondes']} s\")
print(f\"  debit              : {d['par_seconde']} coups/s\")
print(f\"  latence mediane    : {d['latence_mediane_ms']} ms\")
print(f\"  latence p95        : {d['latence_p95_ms']} ms\")
" 2>/dev/null || echo "  reponse brute : $LECTURE"

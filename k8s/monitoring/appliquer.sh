#!/bin/sh
#
# appliquer.sh — pose la surveillance sur le cluster.
#
#   ./k8s/monitoring/appliquer.sh
#
# Pourquoi un script plutot que six `kubectl apply -f` : quatre des objets sont
# des ConfigMaps construits DEPUIS des fichiers (le tableau de bord fait
# 12 ko de JSON, les alertes 200 lignes de YAML). Les recopier a la main dans un
# bloc `data:` en respectant l'indentation serait ingerable, et surtout ils
# cesseraient d'etre relisibles en pull request.
#
# `create --dry-run=client -o yaml | apply -f -` est la forme idiomatique : elle
# fabrique le ConfigMap a partir du fichier, puis l'applique comme n'importe
# quel manifeste. Le fichier reste la source de verite unique.
set -eu

cd "$(dirname "$0")"
NS="${NS:-todo}"
KCTX="${KCTX:-}"
K="kubectl"
[ -n "$KCTX" ] && K="kubectl --context $KCTX"

cm() {
  nom="$1"
  shift
  # --dry-run=client : rien n'est envoye au cluster par cette commande-la, elle
  # se contente d'imprimer le YAML qu'elle aurait cree.
  $K create configmap "$nom" -n "$NS" "$@" --dry-run=client -o yaml | $K apply -f -
}

echo "== les fichiers de configuration deviennent des ConfigMaps =="
# prometheus-config est le seul ConfigMap ecrit a la main : son contenu tient en
# soixante lignes et gagne a etre lu au meme endroit que ses commentaires.
$K apply -f prometheus-config.yaml
cm grafana-datasources         --from-file=prometheus.yml=datasource.yml
cm grafana-dashboards-provider --from-file=dashboards.yml=dashboards-provider.yml
cm grafana-alerting            --from-file=alertes.yml=alertes.yml
cm grafana-dashboards          --from-file=todo-api.json=grafana-dashboard.json

echo "== Prometheus =="
$K apply -f prometheus-rbac.yaml -f prometheus.yaml

echo "== Grafana =="
$K apply -f grafana.yaml

# CORRIGE APRES LA PREMIERE MISE A JOUR DES ALERTES. Une quatrieme alerte
# ajoutee au fichier n'apparaissait pas dans Grafana : le ConfigMap etait bien
# a jour, mais Grafana ne lit son provisioning qu'AU DEMARRAGE. C'est
# exactement la lecon de la phase 2, rencontree une seconde fois — un ConfigMap
# modifie ne pousse rien vers un pod deja vivant.
#
# On relance donc Grafana des que sa configuration change. Sans cette ligne, le
# script rend la main en annoncant un succes, et les alertes du depot ne sont
# pas celles qui tournent.
echo "== Grafana relit son provisioning (il ne le fait qu'au demarrage) =="
$K -n "$NS" rollout restart deployment/grafana

echo "== on attend que les deux soient prets =="
$K -n "$NS" rollout status deployment/prometheus --timeout=180s
$K -n "$NS" rollout status deployment/grafana --timeout=300s

echo
echo "Prometheus : kubectl -n $NS port-forward svc/prometheus 39090:9090"
echo "Grafana    : http://grafana.localhost:8080  (admin / GRAFANA_ADMIN_PASSWORD du Secret)"

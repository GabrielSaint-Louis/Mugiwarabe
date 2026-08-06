# Le runner en service systemd

Ce que ce dossier contient : le **drop-in** posé par-dessus l'unité que
`svc.sh install` génère, et rien d'autre. L'unité elle-même n'est pas ici, elle
est générée à l'installation et elle vit dans `/etc/systemd/system/`.

## Pourquoi un drop-in et pas une unité à nous

`svc.sh uninstall && svc.sh install` réécrit l'unité **entièrement**. Toute
correction faite dedans disparaîtrait au premier de ces deux gestes, sans un
message. Un drop-in, lui, y survit : systemd le fusionne par-dessus l'unité,
quelle que soit la version de celle-ci.

## Installation

```bash
cd ~/actions-runner

# 1. Arrêter le runner s'il tourne encore en nohup
pkill -f 'bin/Runner.Listener'

# 2. Installer le service (demande les droits root)
sudo ./svc.sh install "$USER"
sudo ./svc.sh start

# 3. Poser le drop-in qui corrige ce que l'unité générée n'a pas
SVC=actions.runner.<PROPRIETAIRE>-<DEPOT>.<NOM-DU-RUNNER>.service
sudo install -d "/etc/systemd/system/${SVC}.d"
sudo install -m 644 deploy/systemd/runner-reprise.conf "/etc/systemd/system/${SVC}.d/reprise.conf"
sudo systemctl daemon-reload
sudo systemctl restart "$SVC"
```

Le nom exact du service se lit avec :

```bash
systemctl list-units 'actions.runner.*' --no-pager
```

## Vérifications

```bash
systemctl is-enabled "$SVC"        # enabled  -> survit au redémarrage
systemctl show -p Restart "$SVC"   # always   -> survit à son propre plantage
```

Et la seule qui prouve vraiment quelque chose, depuis l'intérieur d'un job :
`runner-check.yml` affiche `lance par systemd (INVOCATION_ID pose)`.
`INVOCATION_ID` est posé par systemd sur tout process qu'il lance ; un runner
démarré à la main ne l'a pas.

## Le `.path` du runner

Le service lit `~/actions-runner/.path`, figé au moment du `config.sh`. Si un
outil est installé **après** — `kubectl` dans `~/.local/bin`, par exemple —
vérifier qu'il y figure, sinon les jobs échoueront sur un `command not found`
que rien n'explique :

```bash
grep -o '[^:]*\.local/bin' ~/actions-runner/.path
```

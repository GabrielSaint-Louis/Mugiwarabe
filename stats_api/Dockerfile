# Base legere, equivalent Python de node:alpine niveau philosophie.
# "slim" retire les paquets Debian non essentiels, sans les limitations plus
# poussees d'Alpine (Alpine existe aussi pour Python, mais certaines libs C
# compilent moins bien dessus).
#
# Seul ecart avec le Dockerfile donne par le TP : la version est epinglee au
# patch (3.12.8) plutot que laissee sur 3.12, par coherence avec la regle du
# chapitre 5 — le meme Dockerfile doit produire la meme image dans six mois.
FROM python:3.12.8-slim

# Ne pas ecrire de fichiers .pyc pendant l'execution : inutile dans un conteneur
# ephemere, ca evite juste des I/O disque pour rien
ENV PYTHONDONTWRITEBYTECODE=1

# Force la sortie standard de Python a ne pas etre bufferisee : sans ca, les logs
# de l'appli peuvent rester coinces dans un buffer et ne jamais apparaitre dans
# `docker logs` avant un moment (voire jamais si le process crash brutalement)
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Comme pour npm, on copie d'abord uniquement le fichier de dependances
COPY requirements.txt .

# --no-cache-dir : pip ne garde pas de cache local de telechargement, inutile dans
# une image qu'on jette et reconstruit a chaque fois, ca fait juste grossir l'image
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Contrairement a l'image node officielle, l'image python:slim ne fournit pas
# d'utilisateur non-root pret a l'emploi : on le cree nous-meme
RUN adduser --disabled-password --gecos "" appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# uvicorn : le serveur ASGI qui fait tourner l'app FastAPI. --host 0.0.0.0 est
# indispensable dans un conteneur : sur 127.0.0.1 (le defaut), l'app ne serait
# joignable que depuis l'interieur du conteneur lui-meme
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

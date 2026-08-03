import os

import psycopg2
from fastapi import FastAPI, HTTPException

app = FastAPI()

# Ces deux constantes dependent du schema cree au chapitre 6 : a adapter au nom
# reel de la table de taches et de sa colonne d'etat avant de lancer le service.
TABLE_NAME = "tasks"
STATUS_COLUMN = "status"

# Les etats attendus, listes ici pour garantir des compteurs a zero meme quand
# un etat n'a aucune ligne en base (table vide, ou etat jamais encore utilise).
KNOWN_STATUSES = ["todo", "in_progress", "done"]


def get_connection():
    # Ces noms de variables doivent etre exactement ceux choisis au chapitre 7
    # pour l'API Node.js : les deux services lisent la meme configuration, il
    # serait absurde qu'ils l'appellent differemment.
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=3,
    )


@app.get("/health")
def health():
    # Volontairement independant de Postgres : un souci base ne doit pas faire
    # passer le conteneur lui-meme pour mort aux yeux du HEALTHCHECK.
    return {"status": "ok"}


@app.get("/stats")
def get_stats():
    counts = {status: 0 for status in KNOWN_STATUSES}

    try:
        conn = get_connection()
    except psycopg2.OperationalError:
        # Jamais de stacktrace brut renvoye au client : un code d'erreur clair
        # et un message que l'appelant peut logger tel quel.
        raise HTTPException(
            status_code=503,
            detail="stats-api ne parvient pas a joindre la base de donnees",
        )

    try:
        with conn.cursor() as cursor:
            # TABLE_NAME et STATUS_COLUMN sont des constantes internes, jamais une
            # entree utilisateur : l'interpolation ici ne rejoue pas le risque
            # d'injection SQL qu'on aurait avec un parametre recu du client.
            cursor.execute(
                f"SELECT {STATUS_COLUMN}, COUNT(*) FROM {TABLE_NAME} "
                f"GROUP BY {STATUS_COLUMN}"
            )
            for status, count in cursor.fetchall():
                counts[status] = count
    finally:
        conn.close()

    return counts

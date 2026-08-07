-- Le schema du quiz Grand Line.
--
-- Il est applique au demarrage de l'API, en CREATE TABLE IF NOT EXISTS : le
-- deploiement remplace les conteneurs sans jamais toucher au volume de la base,
-- donc ce fichier passe des dizaines de fois sur des tables qui existent deja.
-- Il doit pouvoir etre rejoue sans rien casser, exactement comme le job de
-- deploiement.

CREATE TABLE IF NOT EXISTS question (
  id            SERIAL PRIMARY KEY,
  texte         TEXT NOT NULL,
  propositions  JSONB NOT NULL,
  bonne         SMALLINT NOT NULL,
  origine       TEXT NOT NULL DEFAULT 'banque',
  -- Une question fabriquee par la vigie n'entre en jeu qu'une fois validee.
  -- Un modele externe peut renvoyer quatre propositions identiques ou aucune
  -- bonne reponse, et ca ne doit pas arriver jusqu'a la classe.
  validee       BOOLEAN NOT NULL DEFAULT FALSE,
  creee_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manche (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  ouverte_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  fermee_le   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reponse (
  id         SERIAL PRIMARY KEY,
  manche_id  INTEGER NOT NULL REFERENCES manche(id) ON DELETE CASCADE,
  joueur     TEXT NOT NULL,
  choix      SMALLINT NOT NULL,
  juste      BOOLEAN NOT NULL,
  donnee_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un joueur ne repond qu'une fois par manche. La contrainte est ici et pas
  -- dans le code : trois exemplaires de l'API qui recoivent la meme reponse en
  -- meme temps ne peuvent pas se coordonner entre eux, la base le peut.
  UNIQUE (manche_id, joueur)
);

-- La manche ouverte est lue a chaque affichage du quiz, donc plusieurs fois par
-- seconde des que la classe joue. Sans cet index, chaque lecture parcourt toute
-- la table des manches.
CREATE INDEX IF NOT EXISTS manche_ouverte_idx ON manche (fermee_le) WHERE fermee_le IS NULL;
CREATE INDEX IF NOT EXISTS reponse_manche_idx ON reponse (manche_id);

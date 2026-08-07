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

-- Les doublons de texte accumules AVANT que la contrainte n'existe.
--
-- Cette ligne a ete ajoutee apres un vrai echec en production. La contrainte
-- d'unicite ci-dessous a ete ecrite alors que la base tournait deja avec douze
-- doublons dedans, laisses par la vigie. L'index a refuse d'etre cree, et comme
-- tout ce fichier part en une seule requete, la transaction a ete annulee :
-- AUCUNE table n'a ete creee, pas seulement l'index.
--
-- Le service qui en dependait s'est declare degrade sans que rien n'explique
-- pourquoi. La lecon vaut au-dela d'aujourd'hui : une contrainte ajoutee apres
-- coup doit toujours etre precedee du menage qui la rend possible.
DELETE FROM question a USING question b
 WHERE a.id > b.id AND lower(a.texte) = lower(b.texte);

-- Le meme texte ne doit pas entrer deux fois. La vigie fabrique en boucle, et
-- un modele qui tourne sur le meme sujet finit toujours par se repeter : sans
-- cette contrainte, un joueur reverrait la meme question dans la meme serie.
CREATE UNIQUE INDEX IF NOT EXISTS question_texte_unique ON question (lower(texte));

-- Une partie, c'est la serie d'un joueur : il repond tant qu'il ne se trompe
-- pas. L'etat vit ici et pas dans le navigateur, sinon vider son stockage local
-- suffirait a rejouer indefiniment la meme question et le classement ne
-- vaudrait plus rien.
CREATE TABLE IF NOT EXISTS partie (
  id              SERIAL PRIMARY KEY,
  -- Un jeton aleatoire, et pas l'identifiant : sans lui, il suffirait
  -- d'incrementer un nombre dans l'URL pour repondre a la place de quelqu'un
  -- d'autre.
  jeton           TEXT NOT NULL UNIQUE,
  serie           INTEGER NOT NULL DEFAULT 0,
  en_cours        BOOLEAN NOT NULL DEFAULT TRUE,
  question_id     INTEGER REFERENCES question(id) ON DELETE SET NULL,
  -- Le moment ou la question courante a ete servie. C'est LUI qui fait foi pour
  -- le chronometre : un compte a rebours qui vivrait dans le navigateur se
  -- falsifierait en changeant l'horloge de son telephone.
  servie_le       TIMESTAMPTZ,
  joueur          TEXT,
  commencee_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminee_le     TIMESTAMPTZ,
  -- Pourquoi la partie s'est arretee : mauvaise reponse, temps ecoule, ou
  -- banque epuisee. La troisieme est une victoire, pas une defaite, et le
  -- classement doit pouvoir faire la difference.
  fin             TEXT
);

-- Les questions deja vues dans une partie. Une ligne par question servie, ce
-- qui garantit qu'aucune ne revient dans la meme serie.
CREATE TABLE IF NOT EXISTS partie_vue (
  partie_id   INTEGER NOT NULL REFERENCES partie(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  vue_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (partie_id, question_id)
);

-- Le classement est lu plusieurs fois par seconde des que la classe joue. Sans
-- cet index, chaque lecture trie toute la table des parties.
CREATE INDEX IF NOT EXISTS partie_classement_idx
  ON partie (serie DESC, terminee_le ASC)
  WHERE joueur IS NOT NULL;

CREATE INDEX IF NOT EXISTS partie_jeton_idx ON partie (jeton);

-- Les tables de l'ancien modele, ou le quiz avancait par manches synchronisees.
-- Le modele a change : chaque joueur avance a son rythme et s'arrete a sa
-- premiere erreur. On les retire plutot que de les laisser trainer, mais
-- seulement si elles existent, pour que ce fichier reste rejouable.
DROP TABLE IF EXISTS reponse;
DROP TABLE IF EXISTS manche;

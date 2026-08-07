// La configuration de l'API, lue une seule fois au demarrage.
//
// Le sujet demande deux comportements opposes selon ce qui manque, et la
// difference n'est pas un detail de style :
//
//   - TABLEAU_URL absent : le service demarre quand meme, et il le dit dans ses
//     logs. Le tableau de la classe n'est pas une dependance de l'application,
//     c'est un observateur. Refuser de servir le quiz parce qu'un observateur
//     est absent serait absurde.
//
//   - le mot de passe de la base absent : le service refuse de demarrer. Il ne
//     pourra rien faire d'utile, et un service qui repond 200 en etant incapable
//     de lire ses donnees est plus dangereux qu'un service qui n'est pas la.
//
// C'est la meme regle des deux cotes : on demarre degrade quand on peut encore
// rendre une partie du service, on refuse quand on ne peut rien rendre du tout.

function requis(nom) {
  const valeur = process.env[nom];
  if (!valeur) {
    console.error(`[config] ${nom} est obligatoire et n'est pas fourni, arret.`);
    process.exit(1);
  }
  return valeur;
}

function optionnel(nom, parDefaut, pourquoi) {
  const valeur = process.env[nom];
  if (!valeur) {
    console.warn(`[config] ${nom} absent, on continue : ${pourquoi}`);
    return parDefaut;
  }
  return valeur;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  service: process.env.SERVICE || 'api',
  version: process.env.VERSION || 'dev',

  // Le fichier du pavillon. Son chemin par defaut pointe dans /data, qui est un
  // volume : ecrit ailleurs, le pavillon disparaitrait au prochain deploiement.
  pavillonFichier: process.env.PAVILLON_FICHIER || '/data/pavillon.txt',

  tableau: optionnel(
    'TABLEAU_URL',
    '',
    "aucun carre ne s'allumera au tableau, le service sert quand meme le quiz",
  ),

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: requis('DB_PASSWORD'),
    database: process.env.DB_NAME || 'grandline',
  },
};

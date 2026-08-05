#!/usr/bin/env node
'use strict';

// Migration : le schema, rejoue avant que les tests ne demarrent.
//
// Pourquoi un script separe alors que src/db.js sait deja creer la table au
// demarrage de l'API ? Parce qu'en pipeline, personne ne demarre l'API : les
// tests d'integration attaquent directement le modele et les routes. Sans ce
// script, le premier test tomberait sur un `relation "tasks" does not exist`
// et on croirait a un bug du code.
//
// C'est aussi precisement ce qui manquait dans l'histoire du vendredi 17h32 :
// une migration jouee sur la base de test et jamais sur celle de production.
// Ici, les deux jouent le meme SCHEMA, importe du meme fichier — il ne peut
// pas y avoir de divergence entre les deux, il n'y a qu'une seule source.

const { pool, initSchema } = require('../src/db');

initSchema({ retries: 20, delayMs: 1000 })
  .then(async () => {
    console.log('[migrate] schema en place');
    await pool.end();
  })
  .catch(async (err) => {
    console.error('[migrate] echec :', err.message);
    await pool.end().catch(() => {});
    // Sortie non nulle : le job de la pipeline s'arrete ici plutot que de
    // lancer des tests qui echoueraient tous pour la meme mauvaise raison.
    process.exit(1);
  });

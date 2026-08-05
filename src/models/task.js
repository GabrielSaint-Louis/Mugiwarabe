'use strict';

const { randomUUID } = require('node:crypto');
const { pool } = require('../db');

// Les trois etats admis. La meme liste est reprise cote stats-api (chapitre 8),
// qui compte les taches par etat.
const STATUSES = ['todo', 'in_progress', 'done'];

// Une description est du texte saisi par un humain. Sans borne explicite, un
// POST de 50 000 caracteres passe la validation, gonfle la memoire du process
// et finira par le faire tomber. On tranche a 500 caracteres, la meme valeur
// que le VARCHAR(500) de la colonne en base.
const MAX_DESCRIPTION_LENGTH = 500;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

// Valide une entree utilisateur et renvoie un objet propre.
// `partial` autorise les champs absents (cas du PUT, ou on ne modifie qu'une
// partie de la tache).
function validate(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('le corps de la requete doit etre un objet JSON');
  }

  const { description, status } = input;
  const clean = {};

  if (description !== undefined) {
    if (typeof description !== 'string') {
      throw new ValidationError('description doit etre une chaine de caracteres');
    }
    const trimmed = description.trim();
    if (trimmed === '') {
      throw new ValidationError('description ne peut pas etre vide');
    }
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `description est limitee a ${MAX_DESCRIPTION_LENGTH} caracteres (recue : ${trimmed.length})`
      );
    }
    clean.description = trimmed;
  } else if (!partial) {
    throw new ValidationError('description est obligatoire');
  }

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      throw new ValidationError(`status doit valoir l'un de : ${STATUSES.join(', ')}`);
    }
    clean.status = status;
  }

  return clean;
}

// La base parle en snake_case, l'API en camelCase. La conversion se fait ici,
// une fois, plutot que d'etre eparpillee dans les routes.
function toTask(row) {
  return {
    id: row.id,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at ASC');
  return rows.map(toTask);
}

async function findById(id) {
  // Un id qui n'est pas un UUID valide ferait echouer le cast cote Postgres
  // avec une erreur 500 : on le traite comme un simple "introuvable".
  if (!isUuid(id)) return null;

  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  return rows.length ? toTask(rows[0]) : null;
}

async function create(input) {
  const { description, status = 'todo' } = validate(input);

  // Requete parametree ($1, $2...) : les valeurs ne sont jamais concatenees
  // dans la chaine SQL, donc aucune injection possible.
  const { rows } = await pool.query(
    'INSERT INTO tasks (id, description, status) VALUES ($1, $2, $3) RETURNING *',
    [randomUUID(), description, status]
  );
  return toTask(rows[0]);
}

async function update(id, input) {
  if (!isUuid(id)) return null;

  const changes = validate(input, { partial: true });

  // COALESCE : on ne remplace un champ que si une nouvelle valeur est fournie,
  // ce qui evite de construire dynamiquement la clause SET.
  const { rows } = await pool.query(
    `UPDATE tasks
        SET description = COALESCE($2, description),
            status      = COALESCE($3, status),
            updated_at  = now()
      WHERE id = $1
      RETURNING *`,
    [id, changes.description ?? null, changes.status ?? null]
  );
  return rows.length ? toTask(rows[0]) : null;
}

async function remove(id) {
  if (!isUuid(id)) return false;

  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  return rowCount > 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

module.exports = {
  STATUSES,
  MAX_DESCRIPTION_LENGTH,
  ValidationError,
  findAll,
  findById,
  create,
  update,
  remove,
};

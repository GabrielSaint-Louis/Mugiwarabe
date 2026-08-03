'use strict';

const { randomUUID } = require('node:crypto');

// Stockage en memoire, volontairement ephemere : un redemarrage du conteneur
// efface tout. C'est exactement le probleme que le chapitre 6 resout avec
// PostgreSQL et un volume nomme.
const tasks = new Map();

// Les trois etats admis. La meme liste est reprise cote stats-api (chapitre 8),
// qui compte les taches par etat.
const STATUSES = ['todo', 'in_progress', 'done'];

// Une description est du texte saisi par un humain. Sans borne explicite, un
// POST de 50 000 caracteres passe la validation, gonfle la memoire du process
// et finira par le faire tomber. On tranche a 500 caracteres.
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

function findAll() {
  return [...tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function findById(id) {
  return tasks.get(id) ?? null;
}

function create(input) {
  const { description, status = 'todo' } = validate(input);
  const now = new Date().toISOString();

  const task = {
    id: randomUUID(),
    description,
    status,
    createdAt: now,
    updatedAt: now,
  };

  tasks.set(task.id, task);
  return task;
}

function update(id, input) {
  const existing = tasks.get(id);
  if (!existing) return null;

  const changes = validate(input, { partial: true });
  const updated = {
    ...existing,
    ...changes,
    updatedAt: new Date().toISOString(),
  };

  tasks.set(id, updated);
  return updated;
}

function remove(id) {
  return tasks.delete(id);
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

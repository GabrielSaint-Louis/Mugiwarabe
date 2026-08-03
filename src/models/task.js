'use strict';

const { randomUUID } = require('node:crypto');

// Stockage en memoire, volontairement ephemere : un redemarrage du conteneur
// efface tout. C'est exactement le probleme que le chapitre 6 resout avec
// PostgreSQL et un volume nomme.
const tasks = new Map();

// Les trois etats admis. La meme liste est reprise cote stats-api (chapitre 8),
// qui compte les taches par etat.
const STATUSES = ['todo', 'in_progress', 'done'];

function findAll() {
  return [...tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function findById(id) {
  return tasks.get(id) ?? null;
}

function create({ description, status = 'todo' }) {
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

function update(id, changes) {
  const existing = tasks.get(id);
  if (!existing) return null;

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

module.exports = { STATUSES, findAll, findById, create, update, remove };

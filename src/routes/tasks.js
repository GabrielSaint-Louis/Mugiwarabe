'use strict';

const express = require('express');
const Task = require('../models/task');

const router = express.Router();

// Express 4 n'attrape pas les rejets d'une fonction async : sans ce wrapper,
// une promesse rejetee laisserait la requete pendante au lieu de partir dans
// le errorHandler. Les handlers sont deja async ici parce que le modele passera
// sur PostgreSQL au chapitre 6.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/tasks : creer une tache
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const task = await Task.create(req.body);
    res.status(201).json(task);
  })
);

// GET /api/tasks : lister toutes les taches
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await Task.findAll());
  })
);

// GET /api/tasks/:id : voir une tache
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'tache introuvable' });
    res.json(task);
  })
);

// PUT /api/tasks/:id : modifier une tache
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await Task.update(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'tache introuvable' });
    res.json(task);
  })
);

// DELETE /api/tasks/:id : supprimer une tache
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await Task.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'tache introuvable' });
    res.status(204).end();
  })
);

module.exports = router;

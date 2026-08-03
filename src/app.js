'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const taskRoutes = require('./routes/tasks');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
// Premiere barriere contre les corps demesures : au-dela de 100 ko, express
// refuse avant meme que le JSON ne soit parse. La validation metier prend le
// relais ensuite, avec un message precis sur la longueur de description.
app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Routes
app.use('/api/tasks', taskRoutes);

// Route inconnue : du JSON, comme partout ailleurs sur cette API.
app.use((req, res) => res.status(404).json({ error: 'route introuvable' }));

// Error handling
app.use(errorHandler);

module.exports = app;

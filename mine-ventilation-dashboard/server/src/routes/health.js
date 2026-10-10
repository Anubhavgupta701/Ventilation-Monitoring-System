const express = require('express');
const config = require('../config');
const simulator = require('../simulator');

const router = express.Router();

// GET /healthz — public
router.get('/', async (req, res) => {
  const mongoose = require('mongoose');
  const mongo =
    mongoose.connection.readyState === 1 ? 'up' : 'down';
  let simRunning = false;
  try {
    simRunning = (await simulator.getStatus()).running;
  } catch (e) {
    simRunning = false;
  }
  res.json({
    status: 'ok',
    mongo,
    simulator: simRunning ? 'running' : 'stopped',
    serverTime: new Date().toISOString(),
    version: config.API_VERSION,
  });
});

module.exports = router;

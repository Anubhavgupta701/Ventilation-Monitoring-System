const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const { VentilationDoor } = require('../models/VentilationDoor');
const simulator = require('../simulator');

const router = express.Router();

// GET /doors — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await paged(VentilationDoor, {}, req.query, { doorId: 1 }));
  } catch (e) {
    next(e);
  }
});

// GET /doors/:id — any authenticated user
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const door = await VentilationDoor.findOne({ doorId: req.params.id }).lean();
    if (!door) throw httpError(404, 'NOT_FOUND', `Door ${req.params.id} not found`);
    res.json(door);
  } catch (e) {
    next(e);
  }
});

// POST /doors/:id/open — operator+
router.post('/:id/open', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { before, after } = await simulator.setDoorStatus(req.params.id, 'OPEN');
    await audit(req, 'door.open', 'door', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

// POST /doors/:id/close — operator+
router.post('/:id/close', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { before, after } = await simulator.setDoorStatus(req.params.id, 'CLOSED');
    await audit(req, 'door.close', 'door', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

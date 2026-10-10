const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const { Regulator } = require('../models/Regulator');
const simulator = require('../simulator');

const router = express.Router();

// GET /regulators — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await paged(Regulator, {}, req.query, { regulatorId: 1 }));
  } catch (e) {
    next(e);
  }
});

// GET /regulators/:id — any authenticated user
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const reg = await Regulator.findOne({ regulatorId: req.params.id }).lean();
    if (!reg) throw httpError(404, 'NOT_FOUND', `Regulator ${req.params.id} not found`);
    res.json(reg);
  } catch (e) {
    next(e);
  }
});

// POST /regulators/:id/opening { openingPct } | { delta } — operator+
router.post('/:id/opening', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { openingPct, delta } = req.body || {};
    if (openingPct == null && delta == null) {
      throw httpError(400, 'VALIDATION_ERROR', 'Body must be { openingPct } or { delta }');
    }
    const { before, after } = await simulator.setRegulatorOpening(req.params.id, openingPct, delta);
    await audit(req, 'regulator.opening', 'regulator', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const { Fan } = require('../models/Fan');
const simulator = require('../simulator');

const router = express.Router();

// GET /fans — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await paged(Fan, {}, req.query, { fanId: 1 }));
  } catch (e) {
    next(e);
  }
});

// GET /fans/:id — any authenticated user
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const fan = await Fan.findOne({ fanId: req.params.id }).lean();
    if (!fan) throw httpError(404, 'NOT_FOUND', `Fan ${req.params.id} not found`);
    res.json(fan);
  } catch (e) {
    next(e);
  }
});

// POST /fans/:id/start — operator+
router.post('/:id/start', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { before, after } = await simulator.startFan(req.params.id);
    await audit(req, 'fan.start', 'fan', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

// POST /fans/:id/stop — operator+
router.post('/:id/stop', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { before, after } = await simulator.stopFan(req.params.id);
    await audit(req, 'fan.stop', 'fan', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

// POST /fans/:id/rpm { rpm } — operator+
router.post('/:id/rpm', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { rpm } = req.body || {};
    if (rpm == null) throw httpError(400, 'VALIDATION_ERROR', 'Body must be { rpm }');
    const { before, after } = await simulator.setFanRpm(req.params.id, rpm);
    await audit(req, 'fan.rpm', 'fan', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

// POST /fans/:id/auto { enabled } — operator+
router.post('/:id/auto', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    const { before, after } = await simulator.setFanAuto(req.params.id, enabled);
    await audit(req, 'fan.auto', 'fan', req.params.id, before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

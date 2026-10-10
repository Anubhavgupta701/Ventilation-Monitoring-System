const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { audit } = require('../lib/audit');
const { getSettings } = require('../models/Setting');
const simulator = require('../simulator');

const router = express.Router();

const EDITABLE = ['tickMs', 'persons', 'dailyProductionTonnes', 'retentionDays', 'mineName'];

// GET /settings — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    next(e);
  }
});

// PATCH /settings — officer+; tickMs/persons/production apply live; audit-logged
router.patch('/', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const keys = Object.keys(body).filter((k) => EDITABLE.includes(k));
    if (!keys.length) {
      throw httpError(400, 'VALIDATION_ERROR', `No editable fields (one of ${EDITABLE.join(', ')})`);
    }
    const before = await getSettings();
    const update = {};
    for (const k of keys) update[k] = body[k];
    if (update.tickMs != null) {
      const t = Number(update.tickMs);
      if (!Number.isFinite(t) || t < 2000 || t > 5000) {
        throw httpError(400, 'VALIDATION_ERROR', 'tickMs must be between 2000 and 5000');
      }
      update.tickMs = Math.round(t);
    }
    if (update.persons != null) {
      const p = Number(update.persons);
      if (!Number.isFinite(p) || p < 1) throw httpError(400, 'VALIDATION_ERROR', 'persons must be ≥ 1');
      update.persons = Math.round(p);
    }
    if (update.dailyProductionTonnes != null) {
      const d = Number(update.dailyProductionTonnes);
      if (!Number.isFinite(d) || d < 0) throw httpError(400, 'VALIDATION_ERROR', 'dailyProductionTonnes must be ≥ 0');
      update.dailyProductionTonnes = Math.round(d);
    }
    if (update.retentionDays != null) {
      const r = Number(update.retentionDays);
      if (!Number.isFinite(r) || r < 1) throw httpError(400, 'VALIDATION_ERROR', 'retentionDays must be ≥ 1');
      update.retentionDays = Math.round(r);
    }
    if (update.mineName != null && String(update.mineName).trim() === '') {
      throw httpError(400, 'VALIDATION_ERROR', 'mineName must not be empty');
    }
    const { Setting } = require('../models/Setting');
    const after = await Setting.findOneAndUpdate(
      { key: 'mine' },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();
    // Apply live.
    if (update.tickMs != null) simulator.applyTickMs(update.tickMs);
    await audit(req, 'settings.update', 'settings', 'mine', before, after);
    res.json(after);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

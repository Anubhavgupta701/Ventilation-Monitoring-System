const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const { District } = require('../models/District');

const router = express.Router();

// GET /districts
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await paged(District, {}, req.query, { districtId: 1 }));
  } catch (e) {
    next(e);
  }
});

// POST /districts — officer+
router.post('/', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.districtId || !body.name || body.personsLargestShift == null ||
        body.dailyOutputTonnes == null || !body.lastConnectionBranchId) {
      throw httpError(400, 'VALIDATION_ERROR',
        'districtId, name, personsLargestShift, dailyOutputTonnes and lastConnectionBranchId are required');
    }
    const exists = await District.findOne({ districtId: body.districtId });
    if (exists) throw httpError(409, 'CONFLICT', `District ${body.districtId} already exists`);
    const created = await District.create({
      districtId: body.districtId,
      name: body.name,
      personsLargestShift: body.personsLargestShift,
      dailyOutputTonnes: body.dailyOutputTonnes,
      lastConnectionBranchId: body.lastConnectionBranchId,
    });
    await audit(req, 'district.create', 'district', created.districtId, null, created.toObject());
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PATCH /districts/:id — officer+
router.patch('/:id', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    if (body.districtId && body.districtId !== req.params.id) {
      throw httpError(400, 'VALIDATION_ERROR', 'districtId is immutable');
    }
    delete body.districtId;
    const before = await District.findOne({ districtId: req.params.id }).lean();
    if (!before) throw httpError(404, 'NOT_FOUND', `District ${req.params.id} not found`);
    const updated = await District.findOneAndUpdate(
      { districtId: req.params.id },
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    await audit(req, 'district.update', 'district', updated.districtId, before, updated);
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

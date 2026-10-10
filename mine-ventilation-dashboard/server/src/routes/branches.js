const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const realtime = require('../realtime');
const { Branch } = require('../models/Branch');
const { Sensor } = require('../models/Sensor');

const router = express.Router();
const simulator = require('../simulator');

// GET /branches — with live simulator state per branch
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = await paged(Branch, {}, req.query, { branchId: 1 });
    const live = simulator.getLiveBranches() || {};
    page.data = page.data.map((b) => {
      const obj = typeof b.toObject === 'function' ? b.toObject() : b;
      const l = live[obj.branchId];
      return {
        ...obj,
        live: l
          ? {
              airflowM3min: Math.round(l.qMin * 10) / 10,
              velocityMs: Math.round(l.v * 1000) / 1000,
              pressureDropPa: Math.round(l.dp),
              status: l.status,
            }
          : null,
      };
    });
    res.json(page);
  } catch (e) {
    next(e);
  }
});

// POST /branches — officer+
router.post('/', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.branchId || !body.name || !body.fromNode || !body.toNode || body.area == null || !body.direction) {
      throw httpError(400, 'VALIDATION_ERROR', 'branchId, name, fromNode, toNode, area and direction are required');
    }
    const exists = await Branch.findOne({ branchId: body.branchId });
    if (exists) throw httpError(409, 'CONFLICT', `Branch ${body.branchId} already exists`);
    const created = await Branch.create({
      branchId: body.branchId,
      name: body.name,
      fromNode: body.fromNode,
      toNode: body.toNode,
      area: body.area,
      direction: body.direction,
      path: body.path || [body.fromNode, body.toNode].map((n) => ({ x: n.x, y: n.y })),
      isLastVentilationConnection: !!body.isLastVentilationConnection,
      districtId: body.districtId || null,
      level: body.level || 'L-1',
      resistanceNs2m8: body.resistanceNs2m8 != null ? body.resistanceNs2m8 : 0.05,
      lengthM: body.lengthM != null ? body.lengthM : 0,
      stoppings: body.stoppings || [],
    });
    await audit(req, 'branch.create', 'branch', created.branchId, null, created.toObject());
    realtime.emit('config:changed', { entity: 'branches', ts: new Date().toISOString() });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// GET /branches/:id — branch + sensors on it
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const branch = await Branch.findOne({ branchId: req.params.id }).lean();
    if (!branch) throw httpError(404, 'NOT_FOUND', `Branch ${req.params.id} not found`);
    const sensors = await Sensor.find({ branchId: branch.branchId })
      .sort({ sensorId: 1 })
      .lean();
    res.json({ branch, sensors });
  } catch (e) {
    next(e);
  }
});

// PATCH /branches/:id — officer+
router.patch('/:id', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    if (body.branchId && body.branchId !== req.params.id) {
      throw httpError(400, 'VALIDATION_ERROR', 'branchId is immutable');
    }
    delete body.branchId;
    const before = await Branch.findOne({ branchId: req.params.id }).lean();
    if (!before) throw httpError(404, 'NOT_FOUND', `Branch ${req.params.id} not found`);
    const updated = await Branch.findOneAndUpdate(
      { branchId: req.params.id },
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    await audit(req, 'branch.update', 'branch', updated.branchId, before, updated);
    realtime.emit('config:changed', { entity: 'branches', ts: new Date().toISOString() });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

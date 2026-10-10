const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const realtime = require('../realtime');
const { Sensor } = require('../models/Sensor');
const { Reading } = require('../models/Reading');
const { Alert } = require('../models/Alert');

const router = express.Router();

const RANGES = {
  '1h': 3600 * 1000,
  '6h': 6 * 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};
const MAX_BUCKETS = 300;

// GET /sensors — paged
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await paged(Sensor, {}, req.query, { sensorId: 1 }));
  } catch (e) {
    next(e);
  }
});

// POST /sensors — officer+
router.post('/', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.sensorId || !body.name || !body.locationType) {
      throw httpError(400, 'VALIDATION_ERROR', 'sensorId, name and locationType are required');
    }
    const exists = await Sensor.findOne({ sensorId: body.sensorId });
    if (exists) throw httpError(409, 'CONFLICT', `Sensor ${body.sensorId} already exists`);
    const created = await Sensor.create({
      sensorId: body.sensorId,
      name: body.name,
      locationType: body.locationType,
      branchId: body.branchId || null,
      districtId: body.districtId || null,
      type: body.type || 'virtual',
      expectedIntervalSec: body.expectedIntervalSec || 3,
      safetyCritical: body.safetyCritical !== false,
      parameters: body.parameters || [],
      calibrationDate: body.calibrationDate || null,
      origin: 'simulated',
      mapPosition: body.mapPosition || { x: 0, y: 0 },
    });
    await audit(req, 'sensor.create', 'sensor', created.sensorId, null, created.toObject());
    realtime.emit('config:changed', { entity: 'sensors', ts: new Date().toISOString() });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// GET /sensors/:id/readings?range=1h|6h|24h|7d|30d&to=ISO&from=ISO
// Server-side decimation to ≤ ~300 buckets; gaps preserved as null.
router.get('/:id/readings', authenticate, async (req, res, next) => {
  try {
    const sensorId = req.params.id;
    const range = req.query.range || '1h';
    if (!RANGES[range]) {
      throw httpError(400, 'VALIDATION_ERROR', `range must be one of ${Object.keys(RANGES).join('|')}`);
    }
    const sensor = await Sensor.findOne({ sensorId }).lean();
    if (!sensor) throw httpError(404, 'NOT_FOUND', `Sensor ${sensorId} not found`);

    const to = req.query.to ? new Date(req.query.to) : new Date();
    if (Number.isNaN(to.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - RANGES[range]);
    if (Number.isNaN(from.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
    if (from >= to) throw httpError(400, 'VALIDATION_ERROR', '"from" must be before "to"');
    const spanMs = to.getTime() - from.getTime();
    const bucketMs = spanMs / MAX_BUCKETS;

    const rows = await Reading.aggregate([
      { $match: { sensorId, measuredAt: { $gte: from, $lte: to } } },
      { $sort: { measuredAt: 1 } },
      {
        $group: {
          _id: {
            $floor: { $divide: [{ $subtract: ['$measuredAt', from] }, bucketMs] },
          },
          measuredAt: { $first: '$measuredAt' },
          values: { $first: '$values' },
          quality: { $first: '$quality' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byBucket = new Map(rows.map((r) => [r._id, r]));
    const buckets = [];
    for (let i = 0; i < MAX_BUCKETS; i++) {
      const t = new Date(from.getTime() + i * bucketMs).toISOString();
      const row = byBucket.get(i);
      buckets.push({
        t,
        values: row ? row.values : null,
        quality: row ? row.quality : null,
      });
    }

    res.json({ sensorId, range, from: from.toISOString(), to: to.toISOString(), buckets });
  } catch (e) {
    next(e);
  }
});

// GET /sensors/:id — sensor + latestReading + activeAlerts
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const sensor = await Sensor.findOne({ sensorId: req.params.id }).lean();
    if (!sensor) throw httpError(404, 'NOT_FOUND', `Sensor ${req.params.id} not found`);
    const [latestReading, activeAlerts] = await Promise.all([
      Reading.findOne({ sensorId: sensor.sensorId }).sort({ measuredAt: -1 }).lean(),
      Alert.find({
        sensorId: sensor.sensorId,
        status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
      })
        .sort({ openedAt: -1 })
        .lean(),
    ]);
    res.json({ sensor, latestReading, activeAlerts });
  } catch (e) {
    next(e);
  }
});

// PATCH /sensors/:id — officer+, audit-logged (sensorId immutable)
router.patch('/:id', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    if (body.sensorId && body.sensorId !== req.params.id) {
      throw httpError(400, 'VALIDATION_ERROR', 'sensorId is immutable');
    }
    delete body.sensorId;
    delete body.origin; // origin is always server-stamped
    const before = await Sensor.findOne({ sensorId: req.params.id }).lean();
    if (!before) throw httpError(404, 'NOT_FOUND', `Sensor ${req.params.id} not found`);
    const updated = await Sensor.findOneAndUpdate(
      { sensorId: req.params.id },
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    await audit(req, 'sensor.update', 'sensor', updated.sensorId, before, updated);
    realtime.emit('config:changed', { entity: 'sensors', ts: new Date().toISOString() });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

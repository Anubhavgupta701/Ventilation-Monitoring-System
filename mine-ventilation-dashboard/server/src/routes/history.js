const express = require('express');
const { authenticate } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { Reading, VALUE_PARAMS } = require('../models/Reading');

const router = express.Router();

// GET /history/multi?sensorIds=S4,S5&params=ch4,airflow&from=&to=&buckets=200
// Aligned time buckets across sensors for cross-sensor analytics.
// Any authenticated user.
router.get('/multi', authenticate, async (req, res, next) => {
  try {
    const sensorIds = String(req.query.sensorIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sensorIds.length) {
      throw httpError(400, 'VALIDATION_ERROR', 'sensorIds is required (comma-separated)');
    }
    if (sensorIds.length > 10) {
      throw httpError(400, 'VALIDATION_ERROR', 'At most 10 sensors per request');
    }
    const params = String(req.query.params || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!params.length) {
      throw httpError(400, 'VALIDATION_ERROR', 'params is required (comma-separated)');
    }
    for (const p of params) {
      if (!VALUE_PARAMS.includes(p)) {
        throw httpError(400, 'VALIDATION_ERROR', `Unknown parameter "${p}"`);
      }
    }
    const buckets = Math.min(Math.max(parseInt(req.query.buckets, 10) || 200, 1), 500);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    if (Number.isNaN(to.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getTime() - 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
    if (from >= to) throw httpError(400, 'VALIDATION_ERROR', '"from" must be before "to"');

    const bucketMs = (to.getTime() - from.getTime()) / buckets;

    // Per sensor: average each requested param inside each bucket.
    const avgStage = {};
    for (const p of params) avgStage[p] = { $avg: `$values.${p}` };
    const perSensor = {};
    for (const sensorId of sensorIds) {
      const rows = await Reading.aggregate([
        { $match: { sensorId, measuredAt: { $gte: from, $lte: to } } },
        { $sort: { measuredAt: 1 } },
        {
          $group: {
            _id: { $floor: { $divide: [{ $subtract: ['$measuredAt', from] }, bucketMs] } },
            ...avgStage,
          },
        },
        { $sort: { _id: 1 } },
      ]);
      perSensor[sensorId] = new Map(rows.map((r) => [r._id, r]));
    }

    const out = [];
    for (let i = 0; i < buckets; i++) {
      const data = {};
      for (const sensorId of sensorIds) {
        const row = perSensor[sensorId].get(i);
        const entry = {};
        for (const p of params) {
          entry[p] = row && row[p] != null ? Math.round(row[p] * 1000) / 1000 : null;
        }
        data[sensorId] = entry;
      }
      out.push({ t: new Date(from.getTime() + i * bucketMs).toISOString(), data });
    }

    res.json({
      sensorIds,
      params,
      from: from.toISOString(),
      to: to.toISOString(),
      buckets: out,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

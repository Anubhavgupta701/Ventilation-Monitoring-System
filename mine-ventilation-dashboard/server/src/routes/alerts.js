const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { audit } = require('../lib/audit');
const realtime = require('../realtime');
const { Alert } = require('../models/Alert');

const router = express.Router();

// GET /alerts?status=&severity=&sensorId= — newest first, paged
router.get('/', authenticate, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.sensorId) filter.sensorId = req.query.sensorId;
    res.json(await paged(Alert, filter, req.query, { openedAt: -1, _id: -1 }));
  } catch (e) {
    next(e);
  }
});

// POST /alerts/:id/acknowledge — operator+
router.post('/:id/acknowledge', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const alert = await Alert.findOne({ alertId: req.params.id });
    if (!alert) throw httpError(404, 'NOT_FOUND', `Alert ${req.params.id} not found`);
    if (alert.status === 'RESOLVED') {
      throw httpError(409, 'CONFLICT', 'Alert is already resolved and cannot be acknowledged');
    }
    const note = (req.body && req.body.note) || '';
    const before = alert.toObject();
    if (alert.status === 'ACTIVE') {
      alert.status = 'ACKNOWLEDGED';
      alert.acknowledgedBy = req.user.username;
      alert.acknowledgedAt = new Date();
      alert.ackNote = note;
      alert.history.push({
        ts: new Date(),
        action: 'acknowledged',
        by: req.user.username,
        note,
      });
    } else {
      // Already acknowledged — idempotent, keep a history trail.
      alert.history.push({
        ts: new Date(),
        action: 'acknowledged',
        by: req.user.username,
        note: note || 're-acknowledged',
      });
    }
    await alert.save();
    await audit(req, 'alert.acknowledge', 'alert', alert.alertId, before, alert.toObject());
    realtime.emit('alert:updated', alert.toObject());
    res.json(alert.toObject());
  } catch (e) {
    next(e);
  }
});

module.exports = router;

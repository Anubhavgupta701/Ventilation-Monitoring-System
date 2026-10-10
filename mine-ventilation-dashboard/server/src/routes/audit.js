const express = require('express');
const { authenticate } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { paged } = require('../lib/paginate');
const { AuditLog } = require('../models/AuditLog');

const router = express.Router();

// GET /audit?entityType=&action=&actor=&from=&to=&page=&limit= — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.actor) filter.actor = req.query.actor;
    if (req.query.from || req.query.to) {
      filter.ts = {};
      if (req.query.from) {
        const d = new Date(req.query.from);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
        filter.ts.$gte = d;
      }
      if (req.query.to) {
        const d = new Date(req.query.to);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
        filter.ts.$lte = d;
      }
    }
    res.json(await paged(AuditLog, filter, req.query, { ts: -1, _id: -1 }));
  } catch (e) {
    next(e);
  }
});

module.exports = router;

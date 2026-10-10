const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { audit } = require('../lib/audit');
const realtime = require('../realtime');
const { ThresholdProfile } = require('../models/ThresholdProfile');

const router = express.Router();

// GET /thresholds — all profiles, all versions
router.get('/', authenticate, async (req, res, next) => {
  try {
    const profiles = await ThresholdProfile.find({})
      .sort({ profileKey: 1, version: -1 })
      .lean();
    res.json({ data: profiles, total: profiles.length });
  } catch (e) {
    next(e);
  }
});

// POST /thresholds — officer+: new version of a profileKey (old versions auto-disabled)
router.post('/', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['profileKey', 'parameter', 'locationType', 'unit', 'sourceRef'];
    const missing = required.filter((f) => body[f] == null || body[f] === '');
    if (missing.length) {
      throw httpError(400, 'VALIDATION_ERROR', `Missing required fields: ${missing.join(', ')}`);
    }
    const existing = await ThresholdProfile.find({ profileKey: body.profileKey })
      .sort({ version: -1 })
      .lean();
    const version = existing.length ? existing[0].version + 1 : 1;

    // Auto-disable all older versions of this profileKey.
    if (existing.length) {
      await ThresholdProfile.updateMany(
        { profileKey: body.profileKey },
        { $set: { enabled: false } }
      );
    }

    const created = await ThresholdProfile.create({
      profileKey: body.profileKey,
      version,
      parameter: body.parameter,
      locationType: body.locationType,
      comparator: body.comparator || 'MAX',
      warning: body.warning != null ? body.warning : null,
      critical: body.critical != null ? body.critical : null,
      unit: body.unit,
      ruleType: body.ruleType || 'limit',
      condition: body.condition || null,
      factors: body.factors || null,
      sourceType: body.sourceType || 'DEMO',
      warningSourceType: body.warningSourceType || 'DEMO',
      sourceRef: body.sourceRef,
      sourceDate: body.sourceDate || null,
      verificationNote: body.verificationNote || '',
      enabled: body.enabled !== false,
    });
    await audit(req, 'threshold.version', 'threshold', `${body.profileKey}@v${version}`,
      existing, created.toObject());
    realtime.emit('config:changed', { entity: 'thresholds', ts: new Date().toISOString() });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PATCH /thresholds/:profileKey/enabled — officer+; can't disable the last enabled version
router.patch('/:profileKey/enabled', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      throw httpError(400, 'VALIDATION_ERROR', 'Body must be { enabled: boolean }');
    }
    const versions = await ThresholdProfile.find({ profileKey: req.params.profileKey })
      .sort({ version: -1 })
      .lean();
    if (!versions.length) {
      throw httpError(404, 'NOT_FOUND', `Profile ${req.params.profileKey} not found`);
    }

    let updated;
    if (enabled) {
      // Enable the highest version.
      updated = await ThresholdProfile.findOneAndUpdate(
        { profileKey: req.params.profileKey, version: versions[0].version },
        { $set: { enabled: true } },
        { new: true }
      ).lean();
    } else {
      const enabledVersions = versions.filter((v) => v.enabled);
      if (enabledVersions.length <= 1) {
        throw httpError(409, 'CONFLICT', 'Cannot disable the last enabled version of a profile');
      }
      const target = enabledVersions[0]; // highest enabled version
      updated = await ThresholdProfile.findOneAndUpdate(
        { profileKey: req.params.profileKey, version: target.version },
        { $set: { enabled: false } },
        { new: true }
      ).lean();
    }
    await audit(req, 'threshold.enabled', 'threshold', `${req.params.profileKey}`,
      { enabled: !enabled }, { enabled, version: updated.version });
    realtime.emit('config:changed', { entity: 'thresholds', ts: new Date().toISOString() });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

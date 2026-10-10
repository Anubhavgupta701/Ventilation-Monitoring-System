const express = require('express');
const { authenticate } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { calculateVentilation, DEFAULT_HEAT } = require('../calculations/ventilation');
const { ThresholdProfile } = require('../models/ThresholdProfile');
const { AIR_QTY_PROFILE_KEY } = require('../rules/engine');

const router = express.Router();

// POST /calculations/ventilation — any authenticated user.
// Factors are read from the enabled TP-AIRQTY-FACTORS profile; the heat-rule
// condition comes from the enabled TP-WB-VELOCITY profile.
router.post('/ventilation', authenticate, async (req, res, next) => {
  try {
    const body = req.body || {};
    const { persons, dailyOutputTonnes, area, measuredAirflow } = body;
    for (const [k, v] of Object.entries({ persons, dailyOutputTonnes, area, measuredAirflow })) {
      if (v == null || Number.isNaN(Number(v))) {
        throw httpError(400, 'VALIDATION_ERROR', `Field "${k}" is required and must be numeric`);
      }
    }

    const airProfile = await ThresholdProfile.findOne({
      profileKey: AIR_QTY_PROFILE_KEY,
      enabled: true,
    })
      .sort({ version: -1 })
      .lean();
    if (!airProfile || !airProfile.factors || airProfile.factors.perPerson == null || airProfile.factors.perTonne == null) {
      throw httpError(500, 'CONFIG_ERROR', 'Air-quantity factors profile (TP-AIRQTY-FACTORS) is not configured');
    }

    const heatProfile = await ThresholdProfile.findOne({
      profileKey: 'TP-WB-VELOCITY',
      enabled: true,
    })
      .sort({ version: -1 })
      .lean();
    const heat = heatProfile && heatProfile.condition
      ? {
          triggerAbove: heatProfile.condition.triggerAbove,
          requiresParam: heatProfile.condition.requiresParam,
          min: heatProfile.condition.min,
        }
      : DEFAULT_HEAT;

    const result = calculateVentilation(
      {
        persons: Number(persons),
        dailyOutputTonnes: Number(dailyOutputTonnes),
        area: Number(area),
        measuredAirflow: Number(measuredAirflow),
        wetBulb: body.wetBulb != null ? Number(body.wetBulb) : null,
        measuredVelocity: body.measuredVelocity != null ? Number(body.measuredVelocity) : null,
      },
      {
        perPerson: airProfile.factors.perPerson,
        perTonne: airProfile.factors.perTonne,
        sourceRef: airProfile.sourceRef,
      },
      heat
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

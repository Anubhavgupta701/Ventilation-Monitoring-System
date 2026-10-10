'use strict';
// Pure ventilation calculator — NO database imports.
// factors: { perPerson, perTonne, sourceRef } read from the enabled
// TP-AIRQTY-FACTORS profile by the route handler; never hard-coded here.

// Compound heat rule constants come from the enabled TP-WB-VELOCITY profile
// condition in production use; the pure defaults below are the statutory
// CMR 2017 Reg. 153(2)(d) values and are overridden by the route when the
// profile is available.
const DEFAULT_HEAT = { triggerAbove: 30.5, requiresParam: 'velocity', min: 1.0 };

function r2(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

// v = (Q_m3min / 60) / area_m2
function velocityFromAirflow(qM3Min, areaM2) {
  if (!qM3Min || !areaM2 || areaM2 <= 0) return null;
  return qM3Min / 60 / areaM2;
}

// inputs: { persons, dailyOutputTonnes, area, measuredAirflow, wetBulb?, measuredVelocity? }
// factors: { perPerson, perTonne, sourceRef }
// heat: optional { triggerAbove, requiresParam, min } from the compound profile.
function calculateVentilation(inputs, factors, heat) {
  const { persons, dailyOutputTonnes, area, measuredAirflow } = inputs || {};
  const wetBulb = inputs && inputs.wetBulb != null ? inputs.wetBulb : null;
  const measuredVelocity = inputs && inputs.measuredVelocity != null ? inputs.measuredVelocity : null;
  const perPerson = factors && factors.perPerson;
  const perTonne = factors && factors.perTonne;
  if (
    persons == null || dailyOutputTonnes == null || area == null || measuredAirflow == null ||
    perPerson == null || perTonne == null
  ) {
    throw new Error('calculateVentilation: persons, dailyOutputTonnes, area, measuredAirflow and factors {perPerson, perTonne} are required');
  }
  const h = heat || DEFAULT_HEAT;

  const qByPersons = perPerson * persons;
  const qByOutput = perTonne * dailyOutputTonnes;
  const qRequired = Math.max(qByPersons, qByOutput);
  const velocity = velocityFromAirflow(measuredAirflow, area);
  const velocityRequired = velocityFromAirflow(qRequired, area);
  const complianceMargin = qRequired > 0 ? (measuredAirflow - qRequired) / qRequired : null;

  const steps = [
    { label: 'Air required by persons', expr: `${persons} persons × ${perPerson} m³/min/person`, result: r2(qByPersons) },
    { label: 'Air required by output', expr: `${dailyOutputTonnes} t/day × ${perTonne} m³/min/t`, result: r2(qByOutput) },
    { label: 'Required air quantity (Q_required)', expr: `max(${r2(qByPersons)}, ${r2(qByOutput)})`, result: r2(qRequired) },
    { label: 'Measured velocity', expr: `(${measuredAirflow} / 60) / ${area}`, result: velocity == null ? null : r2(velocity) },
    { label: 'Velocity for required air', expr: `(${r2(qRequired)} / 60) / ${area}`, result: velocityRequired == null ? null : r2(velocityRequired) },
    {
      label: 'Compliance margin',
      expr: `(${measuredAirflow} − ${r2(qRequired)}) / ${r2(qRequired)}`,
      result: complianceMargin == null ? null : r2(complianceMargin),
    },
  ];

  const airQuantity = measuredAirflow >= qRequired ? 'OK' : 'SHORTFALL';

  let heatRule = 'NOT_APPLICABLE';
  if (wetBulb != null && measuredVelocity != null) {
    heatRule = wetBulb > h.triggerAbove && measuredVelocity < h.min ? 'VIOLATED' : 'OK';
    steps.push({
      label: 'Heat rule (wet-bulb > trigger AND velocity < minimum)',
      expr: `${wetBulb} > ${h.triggerAbove} AND ${measuredVelocity} < ${h.min}`,
      result: heatRule,
    });
  }

  const overall = airQuantity === 'OK' && heatRule !== 'VIOLATED' ? 'COMPLIANT' : 'NON_COMPLIANT';

  return {
    inputs: {
      persons,
      dailyOutputTonnes,
      area,
      measuredAirflow,
      wetBulb,
      measuredVelocity,
    },
    factors: { perPerson, perTonne, sourceRef: (factors && factors.sourceRef) || '' },
    steps,
    results: {
      qByPersons: r2(qByPersons),
      qByOutput: r2(qByOutput),
      qRequired: r2(qRequired),
      velocity: velocity == null ? null : r2(velocity),
      velocityRequired: velocityRequired == null ? null : r2(velocityRequired),
      complianceMargin: complianceMargin == null ? null : r2(complianceMargin),
      airQuantity,
      heatRule,
      overall,
    },
  };
}

module.exports = { calculateVentilation, velocityFromAirflow, DEFAULT_HEAT };

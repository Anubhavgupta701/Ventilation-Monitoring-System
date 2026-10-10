'use strict';
// Ventilation calculator tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateVentilation, velocityFromAirflow } = require('../src/calculations/ventilation');

const FACTORS = { perPerson: 6, perTonne: 2.5, sourceRef: 'CMR 2017 Reg. 153(2)(a)' };

test('velocity = Q/60/A and Q_required = max(6·persons, 2.5·tonnes)', () => {
  assert.ok(Math.abs(velocityFromAirflow(1000, 8) - 1000 / 60 / 8) < 1e-9);
  const r = calculateVentilation(
    { persons: 120, dailyOutputTonnes: 400, area: 8, measuredAirflow: 1000 },
    FACTORS
  );
  assert.equal(r.results.qByPersons, 720);
  assert.equal(r.results.qByOutput, 1000);
  assert.equal(r.results.qRequired, 1000);
  assert.equal(r.results.velocity, 2.08);
  assert.equal(r.results.velocityRequired, 2.08);
  assert.equal(r.results.complianceMargin, 0);
  assert.equal(r.results.airQuantity, 'OK');
  assert.equal(r.results.heatRule, 'NOT_APPLICABLE');
  assert.equal(r.results.overall, 'COMPLIANT');
  assert.deepEqual(r.factors, FACTORS);
  assert.deepEqual(r.inputs, {
    persons: 120, dailyOutputTonnes: 400, area: 8, measuredAirflow: 1000,
    wetBulb: null, measuredVelocity: null,
  });
});

test('steps echo the working with label/expr/result', () => {
  const r = calculateVentilation(
    { persons: 120, dailyOutputTonnes: 400, area: 8, measuredAirflow: 1000 },
    FACTORS
  );
  assert.ok(r.steps.length >= 6);
  for (const s of r.steps) {
    assert.ok(s.label && s.expr, 'each step needs label + expr');
    assert.ok('result' in s);
  }
  const byPersons = r.steps.find((s) => s.label === 'Air required by persons');
  assert.equal(byPersons.result, 720);
  assert.ok(byPersons.expr.includes('120') && byPersons.expr.includes('6'));
});

test('shortfall → margin negative, airQuantity SHORTFALL, overall NON_COMPLIANT', () => {
  const r = calculateVentilation(
    { persons: 120, dailyOutputTonnes: 400, area: 8, measuredAirflow: 900 },
    FACTORS
  );
  assert.equal(r.results.complianceMargin, -0.1);
  assert.equal(r.results.airQuantity, 'SHORTFALL');
  assert.equal(r.results.overall, 'NON_COMPLIANT');
});

test('heat rule: wetBulb > 30.5 AND velocity < 1.0 → VIOLATED', () => {
  const violated = calculateVentilation(
    { persons: 10, dailyOutputTonnes: 10, area: 8, measuredAirflow: 1000, wetBulb: 31, measuredVelocity: 0.5 },
    FACTORS
  );
  assert.equal(violated.results.heatRule, 'VIOLATED');
  assert.equal(violated.results.overall, 'NON_COMPLIANT');

  const ok = calculateVentilation(
    { persons: 10, dailyOutputTonnes: 10, area: 8, measuredAirflow: 1000, wetBulb: 30.5, measuredVelocity: 0.5 },
    FACTORS
  );
  assert.equal(ok.results.heatRule, 'OK');
  assert.equal(ok.results.overall, 'COMPLIANT');
});

test('factors come from the caller (profile), not hard-coded', () => {
  const r = calculateVentilation(
    { persons: 120, dailyOutputTonnes: 400, area: 8, measuredAirflow: 1000 },
    { perPerson: 10, perTonne: 5, sourceRef: 'custom' }
  );
  assert.equal(r.results.qByPersons, 1200);
  assert.equal(r.results.qByOutput, 2000);
  assert.equal(r.results.qRequired, 2000);
  assert.equal(r.results.airQuantity, 'SHORTFALL');
});

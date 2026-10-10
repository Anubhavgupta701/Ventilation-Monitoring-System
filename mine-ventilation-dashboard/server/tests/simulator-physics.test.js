'use strict';
// Correlated simulation physics tests (pure network solve — no DB).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../src/simulator');
const { evaluateBreaches, selectEnabledProfiles } = require('../src/rules/engine');

// Seed-like base resistances for the 13-branch network.
function baseBranchR() {
  const R = {
    'B-SHAFT': 0.06, 'B-INTAKE': 0.10, 'B-GALLERY': 0.14, 'B-RAISE-1': 0.08,
    'B-D1FEED': 0.12, 'B-W1': 0.55, 'B-W2': 0.55, 'B-RAISE-2': 0.08,
    'B-D2FEED': 0.12, 'B-W3': 0.55, 'B-W4': 0.55, 'B-RETRAISE': 0.14, 'B-FANDRIFT': 0.18,
  };
  const area = { 'B-W1': 8, 'B-W2': 8, 'B-W3': 8, 'B-W4': 8 };
  const out = {};
  for (const [id, r] of Object.entries(R)) {
    // regulators at 70% opening on the working branches, as seeded
    const reg = ['B-W1', 'B-W2', 'B-W3', 'B-W4'].includes(id) ? { openingPct: 70 } : null;
    out[id] = {
      R: sim.effectiveResistance(id, r, reg, { status: 'OPEN' }, null),
      area: area[id] || 10,
    };
  }
  return out;
}

const FULL_PRESSURE = [{ P: 1800 }, { P: 600 }, { P: 600 }]; // main + 2 aux at rated rpm

test('fan rpm change → branch airflow/velocity change (affinity)', () => {
  const branchR = baseBranchR();
  const full = sim.solveNetwork(branchR, FULL_PRESSURE);
  // Main fan derated to 60% rpm → P = 1800 × 0.6²
  const derated = sim.solveNetwork(branchR, [{ P: 1800 * 0.36 }, { P: 600 }, { P: 600 }]);
  assert.ok(derated.qTotal < full.qTotal, 'total flow must fall when fan rpm falls');
  const qW1full = full.branches['B-W1'].q;
  const qW1der = derated.branches['B-W1'].q;
  assert.ok(qW1der < qW1full, 'working-branch airflow must fall');
  assert.ok(derated.branches['B-W1'].v < full.branches['B-W1'].v, 'velocity must fall');
  assert.ok(derated.branches['B-W1'].dp < full.branches['B-W1'].dp, 'pressure drop must fall');
  // sanity: normal duty point is a healthy mine (Q_total ≈ 39 m³/s)
  assert.ok(full.qTotal > 35 && full.qTotal < 45, `Q_total=${full.qTotal}`);
});

test('door close → branch flow redistributes (closed drops, sister rises)', () => {
  const open = baseBranchR();
  const closed = baseBranchR();
  closed['B-W1'] = {
    R: sim.effectiveResistance('B-W1', 0.55, { openingPct: 70 }, { status: 'CLOSED' }, null),
    area: 8,
  };
  const sOpen = sim.solveNetwork(open, FULL_PRESSURE);
  const sClosed = sim.solveNetwork(closed, FULL_PRESSURE);
  const w1o = sOpen.branches['B-W1'].q;
  const w1c = sClosed.branches['B-W1'].q;
  const w2o = sOpen.branches['B-W2'].q;
  const w2c = sClosed.branches['B-W2'].q;
  assert.ok(w1c < w1o * 0.1, `closed branch flow collapses (${w1o.toFixed(2)} → ${w1c.toFixed(2)})`);
  assert.ok(w2c > w2o, `parallel branch picks up flow (${w2o.toFixed(2)} → ${w2c.toFixed(2)})`);
  assert.ok(sClosed.qTotal < sOpen.qTotal, 'total flow falls slightly');
});

test('regulator opening change → branch ΔP changes', () => {
  const r70 = sim.effectiveResistance('B-W1', 0.55, { openingPct: 70 }, { status: 'OPEN' }, null);
  const r15 = sim.effectiveResistance('B-W1', 0.55, { openingPct: 15 }, { status: 'OPEN' }, null);
  assert.ok(r15 > r70 * 5, `closing the regulator must raise resistance sharply (${r70.toFixed(2)} → ${r15.toFixed(2)})`);
  const mk = (rW1) => {
    const b = baseBranchR();
    b['B-W1'] = { R: rW1, area: 8 };
    return sim.solveNetwork(b, FULL_PRESSURE);
  };
  const dp70 = mk(r70).branches['B-W1'].dp;
  const dp15 = mk(r15).branches['B-W1'].dp;
  assert.notEqual(Math.round(dp70), Math.round(dp15), 'branch pressure drop must change');
  // opening clamp: below 5% is clamped to 5%
  const r1 = sim.effectiveResistance('B-W1', 0.55, { openingPct: 1 }, { status: 'OPEN' }, null);
  const r5 = sim.effectiveResistance('B-W1', 0.55, { openingPct: 5 }, { status: 'OPEN' }, null);
  assert.equal(r1, r5, 'opening below 5% clamps to 5%');
});

test('methane-spike raises CH4 → rule engine fires (no invented limits)', () => {
  // CH4 profile shape exactly as seeded (CMR 2017 Reg. 153(2)(c) sourceRef).
  const profiles = selectEnabledProfiles([
    {
      profileKey: 'TP-CH4-ANY', version: 1, enabled: true, parameter: 'ch4',
      locationType: 'ANY_PLACE', comparator: 'MAX', warning: 1.0, critical: 1.25,
      unit: '%vol', ruleType: 'limit', sourceRef: 'CMR 2017 Reg. 153(2)(c)',
    },
  ]);
  const sensor = { sensorId: 'S5', locationType: 'WORKING_PLACE', branchId: 'B-W3' };
  const phys = sim.BRANCH_PHYSICS['B-W3'];
  const branchR = baseBranchR();
  const solved = sim.solveNetwork(branchR, FULL_PRESSURE);
  const qMin = solved.branches['B-W3'].q * 60;

  const ch4Normal = (phys.gasE / qMin) * 100;
  const calm = evaluateBreaches({ reading: { values: { ch4: ch4Normal } }, sensor, profiles });
  assert.equal(calm.length, 0, `normal CH4 (${ch4Normal.toFixed(2)}%) must not breach`);

  const ch4Spike = ((phys.gasE * 8) / qMin) * 100; // methane-spike fault: E × 8
  const breach = evaluateBreaches({ reading: { values: { ch4: ch4Spike } }, sensor, profiles });
  assert.equal(breach.length, 1, 'spiked CH4 must breach');
  assert.equal(breach[0].severity, 'CRITICAL');
  assert.equal(breach[0].parameter, 'ch4');
  assert.equal(breach[0].thresholdSnapshot.sourceRef, 'CMR 2017 Reg. 153(2)(c)');
});

test('zero fan pressure → zero flow everywhere (no NaNs)', () => {
  const solved = sim.solveNetwork(baseBranchR(), [{ P: 0 }, { P: 0 }]);
  assert.equal(solved.qTotal, 0);
  for (const fl of Object.values(solved.branches)) {
    assert.equal(fl.q, 0);
    assert.equal(fl.dp, 0);
    assert.ok(Number.isFinite(fl.v));
  }
});

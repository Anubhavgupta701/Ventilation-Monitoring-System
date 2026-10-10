'use strict';
// Rule-engine boundary tests — boundaries are compliant (strictly-past-limit breaches).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateBreaches,
  selectEnabledProfiles,
  selectProfile,
  isClear,
} = require('../src/rules/engine');

const PROFILES = [
  { profileKey: 'TP-O2-GENERAL', version: 1, parameter: 'o2', locationType: 'ANY_PLACE',
    comparator: 'MIN', warning: 19.5, critical: 19, unit: '%vol', ruleType: 'limit',
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(b)', enabled: true },
  { profileKey: 'TP-CO2-GENERAL', version: 1, parameter: 'co2', locationType: 'ANY_PLACE',
    comparator: 'MAX', warning: 0.4, critical: 0.5, unit: '%vol', ruleType: 'limit',
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(b)', enabled: true },
  { profileKey: 'TP-CH4-DRET', version: 1, parameter: 'ch4', locationType: 'DISTRICT_RETURN_GENERAL_BODY',
    comparator: 'MAX', warning: 0.6, critical: 0.75, unit: '%vol', ruleType: 'limit',
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(c)', enabled: true },
  { profileKey: 'TP-CH4-ANY', version: 1, parameter: 'ch4', locationType: 'ANY_PLACE',
    comparator: 'MAX', warning: 1.0, critical: 1.25, unit: '%vol', ruleType: 'limit',
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(c)', enabled: true },
  { profileKey: 'TP-WB-GENERAL', version: 1, parameter: 'wetBulb', locationType: 'WORKING_PLACE',
    comparator: 'MAX', warning: 31.0, critical: 33.5, unit: '°C', ruleType: 'limit',
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(d)', enabled: true },
  { profileKey: 'TP-WB-VELOCITY', version: 1, parameter: 'wetBulb', locationType: 'WORKING_PLACE',
    comparator: 'MAX', warning: null, critical: null, unit: '°C', ruleType: 'compound',
    condition: { triggerAbove: 30.5, requiresParam: 'velocity', min: 1.0, unit: 'm/s' },
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(d)', enabled: true },
  { profileKey: 'TP-AIRQTY-FACTORS', version: 1, parameter: 'requiredAir',
    locationType: 'LAST_VENTILATION_CONNECTION', comparator: 'MIN',
    warning: null, critical: null, unit: 'm³/min', ruleType: 'limit',
    factors: { perPerson: 6, perTonne: 2.5 },
    sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(a)', enabled: true },
];

const S4 = { sensorId: 'S4', locationType: 'DISTRICT_RETURN_GENERAL_BODY', branchId: 'B-DRET' };
const S5 = { sensorId: 'S5', locationType: 'WORKING_PLACE', branchId: 'B-DWORK' };
const S3 = { sensorId: 'S3', locationType: 'LAST_VENTILATION_CONNECTION', branchId: 'B-LVC', districtId: 'D1' };
const D1 = { districtId: 'D1', personsLargestShift: 120, dailyOutputTonnes: 400, lastConnectionBranchId: 'B-LVC' };

const breaching = (reading, sensor, district) =>
  evaluateBreaches({ reading, sensor, profiles: PROFILES, district });

test('19.0 O₂ is compliant at the statutory limit (no CRITICAL); 18.9 is CRITICAL; 19.3 is WARNING', () => {
  const atBoundary = breaching({ values: { o2: 19.0 } }, S4);
  assert.ok(atBoundary.every((b) => b.severity !== 'CRITICAL'), 'no critical breach at 19.0');
  const crit = breaching({ values: { o2: 18.9 } }, S4);
  assert.equal(crit.length, 1);
  assert.equal(crit[0].severity, 'CRITICAL');
  assert.equal(crit[0].type, 'LIMIT');
  assert.equal(crit[0].profileKey, 'TP-O2-GENERAL');
  const warn = breaching({ values: { o2: 19.3 } }, S4);
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, 'WARNING');
});

test('0.5 CO₂ is compliant at the statutory limit (warning only, no critical)', () => {
  const b = breaching({ values: { co2: 0.5 } }, S4);
  assert.ok(b.every((x) => x.severity !== 'CRITICAL'));
  assert.equal(b.length, 1);
  assert.equal(b[0].severity, 'WARNING'); // > 0.4 warning, not > 0.5 critical
  const crit = breaching({ values: { co2: 0.51 } }, S4);
  assert.equal(crit[0].severity, 'CRITICAL');
});

test('33.5 wet-bulb is compliant at the statutory limit (warning only, no critical)', () => {
  const b = breaching({ values: { wetBulb: 33.5 } }, S5);
  assert.ok(b.every((x) => x.severity !== 'CRITICAL'));
  assert.equal(b.length, 1);
  assert.equal(b[0].severity, 'WARNING');
  const crit = breaching({ values: { wetBulb: 33.6 } }, S5);
  assert.equal(crit[0].severity, 'CRITICAL');
});

test('compound heat rule: 30.5 does NOT trigger; 30.6 + low velocity does', () => {
  assert.equal(breaching({ values: { wetBulb: 30.5, velocity: 0.5 } }, S5).length, 0);
  assert.equal(breaching({ values: { wetBulb: 30.6, velocity: 1.5 } }, S5).length, 0);
  const b = breaching({ values: { wetBulb: 30.6, velocity: 0.9 } }, S5);
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'COMPOUND');
  assert.equal(b[0].severity, 'CRITICAL');
  assert.equal(b[0].parameter, 'wetBulb');
  assert.equal(b[0].profileKey, 'TP-WB-VELOCITY');
});

test('specific locationType profile beats ANY_PLACE for the same parameter', () => {
  const b = breaching({ values: { ch4: 0.8 } }, S4);
  assert.equal(b.length, 1);
  assert.equal(b[0].profileKey, 'TP-CH4-DRET'); // 0.75 critical, not TP-CH4-ANY (1.25)
  assert.equal(b[0].severity, 'CRITICAL');
});

test('air quantity uses factors from the profile, not hard-coded numbers', () => {
  // D1: max(6*120, 2.5*400) = max(720, 1000) = 1000 m³/min required.
  assert.equal(breaching({ values: { airflow: 1200 } }, S3, D1).length, 0);
  const warn = breaching({ values: { airflow: 1050 } }, S3, D1); // 5% margin → WARNING
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, 'WARNING');
  assert.equal(warn[0].profileKey, 'TP-AIRQTY-FACTORS');
  const crit = breaching({ values: { airflow: 950 } }, S3, D1); // shortfall → CRITICAL
  assert.equal(crit.length, 1);
  assert.equal(crit[0].severity, 'CRITICAL');

  // Different factors on the profile → different requirement (data-driven).
  const alt = PROFILES.map((p) =>
    p.profileKey === 'TP-AIRQTY-FACTORS'
      ? { ...p, factors: { perPerson: 10, perTonne: 5 } }
      : p
  );
  // max(10*120, 5*400) = 2000 → 1050 is now a CRITICAL shortfall.
  const b2 = evaluateBreaches({ reading: { values: { airflow: 1050 } }, sensor: S3, profiles: alt, district: D1 });
  assert.equal(b2.length, 1);
  assert.equal(b2[0].severity, 'CRITICAL');
});

test('air-quantity rule only applies at the district last-ventilation-connection sensor', () => {
  // Same low airflow on a non-LVC sensor → no air-quantity breach.
  assert.equal(breaching({ values: { airflow: 100 } }, S4, D1).length, 0);
});

test('isClear applies a 5% deadband before counting a normal reading', () => {
  const alert = {
    parameter: 'co2', type: 'LIMIT',
    thresholdSnapshot: { comparator: 'MAX', warning: 0.4, critical: 0.5, profileKey: 'TP-CO2-GENERAL' },
  };
  // 0.39 is below warning but within 5% deadband (0.4*0.95=0.38) → not clear.
  assert.equal(isClear({ alert, values: { co2: 0.39 }, profiles: PROFILES }), false);
  assert.equal(isClear({ alert, values: { co2: 0.37 }, profiles: PROFILES }), true);

  const o2Alert = {
    parameter: 'o2', type: 'LIMIT',
    thresholdSnapshot: { comparator: 'MIN', warning: 19.5, critical: 19, profileKey: 'TP-O2-GENERAL' },
  };
  assert.equal(isClear({ alert: o2Alert, values: { o2: 20.0 }, profiles: PROFILES }), false); // 19.5*1.05=20.475
  assert.equal(isClear({ alert: o2Alert, values: { o2: 20.6 }, profiles: PROFILES }), true);
});

test('selectProfile picks exact location over ANY_PLACE and highest version', () => {
  const ps = [
    { profileKey: 'TP-CH4-ANY', version: 2, parameter: 'ch4', locationType: 'ANY_PLACE', ruleType: 'limit', enabled: true },
    { profileKey: 'TP-CH4-ANY', version: 3, parameter: 'ch4', locationType: 'ANY_PLACE', ruleType: 'limit', enabled: true },
    { profileKey: 'TP-CH4-DRET', version: 1, parameter: 'ch4', locationType: 'DISTRICT_RETURN_GENERAL_BODY', ruleType: 'limit', enabled: true },
  ];
  const picked = selectProfile(ps, 'ch4', 'DISTRICT_RETURN_GENERAL_BODY');
  assert.equal(picked.profileKey, 'TP-CH4-DRET');
  const pickedAny = selectProfile(ps, 'ch4', 'MAIN_RETURN');
  assert.equal(pickedAny.profileKey, 'TP-CH4-ANY');
  assert.equal(pickedAny.version, 3);
});

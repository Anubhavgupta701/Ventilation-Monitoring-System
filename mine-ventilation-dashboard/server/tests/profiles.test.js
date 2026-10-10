'use strict';
// Threshold version-selection tests: highest enabled version wins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectEnabledProfiles } = require('../src/rules/engine');

function prof(key, version, enabled, extra) {
  return {
    profileKey: key, version, enabled,
    parameter: 'ch4', locationType: 'ANY_PLACE', comparator: 'MAX',
    warning: 1.0, critical: 1.25, unit: '%vol', ruleType: 'limit',
    sourceRef: 'CMR 2017 Reg. 153(2)(c)',
    ...(extra || {}),
  };
}

test('highest enabled version wins per profileKey', () => {
  const profiles = [
    prof('TP-CH4-ANY', 1, true),
    prof('TP-CH4-ANY', 2, true),
    prof('TP-CH4-ANY', 3, false), // newest but disabled → ignored
    prof('TP-O2-GENERAL', 1, true),
  ];
  const selected = selectEnabledProfiles(profiles);
  assert.equal(selected.length, 2);
  const ch4 = selected.find((p) => p.profileKey === 'TP-CH4-ANY');
  assert.equal(ch4.version, 2);
});

test('disabled profiles are excluded entirely', () => {
  const selected = selectEnabledProfiles([prof('TP-CH4-ANY', 5, false)]);
  assert.equal(selected.length, 0);
});

test('version numbers need not be contiguous', () => {
  const selected = selectEnabledProfiles([
    prof('TP-CH4-ANY', 1, true),
    prof('TP-CH4-ANY', 7, true),
    prof('TP-CH4-ANY', 4, true),
  ]);
  assert.equal(selected[0].version, 7);
});

'use strict';
// Pure rule engine — NO database imports. Input is plain data; output is
// plain breach descriptors. All limits/factors come from the threshold
// profiles passed in; nothing is hard-coded here.

const AIR_QTY_PROFILE_KEY = 'TP-AIRQTY-FACTORS';
const ANY_PLACE = 'ANY_PLACE';

// Fraction used for the 5% deadband when deciding a breach has cleared.
const DEADBAND = 0.05;
// Margin below which an air-quantity WARNING is raised (10%).
const AIR_QTY_WARNING_MARGIN = 0.10;

function locationMatches(profileLocationType, sensorLocationType) {
  return profileLocationType === ANY_PLACE || profileLocationType === sensorLocationType;
}

// Highest enabled version per profileKey wins. Input `profiles` should already
// be the enabled set; this is also unit-tested directly.
function selectEnabledProfiles(profiles) {
  const byKey = new Map();
  for (const p of profiles || []) {
    if (!p || p.enabled === false) continue;
    const cur = byKey.get(p.profileKey);
    if (!cur || (p.version || 0) > (cur.version || 0)) byKey.set(p.profileKey, p);
  }
  return [...byKey.values()];
}

// Pick the single best limit profile for {parameter, locationType}:
// exact locationType match beats ANY_PLACE, then highest version.
function selectProfile(profiles, parameter, locationType) {
  const candidates = (profiles || []).filter(
    (p) =>
      p.ruleType !== 'compound' &&
      p.parameter === parameter &&
      locationMatches(p.locationType, locationType)
  );
  candidates.sort((a, b) => {
    const aExact = a.locationType !== ANY_PLACE ? 0 : 1;
    const bExact = b.locationType !== ANY_PLACE ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return (b.version || 0) - (a.version || 0);
  });
  return candidates[0] || null;
}

function snapshotOf(p) {
  return {
    warning: p.warning == null ? null : p.warning,
    critical: p.critical == null ? null : p.critical,
    unit: p.unit || '',
    comparator: p.comparator || 'MAX',
    sourceRef: p.sourceRef || '',
    sourceDate: p.sourceDate ? new Date(p.sourceDate).toISOString() : null,
    profileKey: p.profileKey,
    version: p.version,
  };
}

function evalLimit(profile, value) {
  const { comparator, warning, critical } = profile;
  let severity = null;
  // Boundaries are compliant: breach only when STRICTLY past the limit.
  if (comparator === 'MIN') {
    if (value < critical) severity = 'CRITICAL';
    else if (warning != null && value < warning) severity = 'WARNING';
  } else {
    // MAX (default)
    if (value > critical) severity = 'CRITICAL';
    else if (warning != null && value > warning) severity = 'WARNING';
  }
  if (!severity) return null;
  return {
    parameter: profile.parameter,
    type: 'LIMIT',
    severity,
    value,
    profileKey: profile.profileKey,
    version: profile.version,
    thresholdSnapshot: snapshotOf(profile),
  };
}

function evalCompound(profile, values) {
  const cond = profile.condition || {};
  const primary = values[profile.parameter];
  const required = cond.requiresParam ? values[cond.requiresParam] : undefined;
  if (typeof primary !== 'number' || typeof required !== 'number') return null;
  // Strictly greater than triggerAbove AND strictly below min.
  if (primary > cond.triggerAbove && required < cond.min) {
    const snap = snapshotOf(profile);
    snap.condition = cond;
    return {
      parameter: profile.parameter,
      type: 'COMPOUND',
      severity: 'CRITICAL',
      value: primary,
      profileKey: profile.profileKey,
      version: profile.version,
      thresholdSnapshot: snap,
    };
  }
  return null;
}

function evalAirQuantity(profile, measuredAirflow, district) {
  const perPerson = profile.factors && profile.factors.perPerson;
  const perTonne = profile.factors && profile.factors.perTonne;
  if (!perPerson || !perTonne || !district) return null;
  if (typeof measuredAirflow !== 'number') return null;
  const qByPersons = perPerson * district.personsLargestShift;
  const qByOutput = perTonne * district.dailyOutputTonnes;
  const qRequired = Math.max(qByPersons, qByOutput);
  if (qRequired <= 0) return null;
  const margin = (measuredAirflow - qRequired) / qRequired;
  let severity = null;
  if (margin < 0) severity = 'CRITICAL'; // SHORTFALL
  else if (margin < AIR_QTY_WARNING_MARGIN) severity = 'WARNING';
  if (!severity) return null;
  const snap = snapshotOf(profile);
  snap.qRequired = qRequired;
  snap.qByPersons = qByPersons;
  snap.qByOutput = qByOutput;
  return {
    parameter: 'airflow',
    type: 'LIMIT',
    severity,
    value: measuredAirflow,
    profileKey: profile.profileKey,
    version: profile.version,
    thresholdSnapshot: snap,
  };
}

// Main entry. reading: { values: {...} }, sensor: { locationType, branchId },
// profiles: enabled profiles (run through selectEnabledProfiles), district: optional.
function evaluateBreaches({ reading, sensor, profiles, district }) {
  const breaches = [];
  const values = (reading && reading.values) || {};
  const locationType = sensor && sensor.locationType;

  for (const param of Object.keys(values)) {
    const value = values[param];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    if (param === 'requiredAir') continue;
    const profile = selectProfile(profiles, param, locationType);
    if (!profile) continue;
    const breach = evalLimit(profile, value);
    if (breach) breaches.push(breach);
  }

  for (const p of profiles || []) {
    if (p.ruleType !== 'compound') continue;
    if (!locationMatches(p.locationType, locationType)) continue;
    const breach = evalCompound(p, values);
    if (breach) breaches.push(breach);
  }

  // Air-quantity rule: measured airflow at the district's last ventilation
  // connection branch vs Q_required from the factors profile.
  const airProfile = (profiles || []).find((p) => p.profileKey === AIR_QTY_PROFILE_KEY);
  if (
    airProfile &&
    district &&
    locationType === 'LAST_VENTILATION_CONNECTION' &&
    sensor.branchId &&
    district.lastConnectionBranchId === sensor.branchId
  ) {
    const breach = evalAirQuantity(airProfile, values.airflow, district);
    if (breach) breaches.push(breach);
  }

  return breaches;
}

// Deadband "clear" check: has the breach cleared comfortably (5% deadband),
// given the current values? Used for the 3-consecutive-normal auto-resolve.
function isClear({ alert, values, profiles, district }) {
  if (!alert || alert.type === 'STALE_COMMS') return false;
  const v = (values || {})[alert.parameter];
  if (typeof v !== 'number' || Number.isNaN(v)) return false;
  const snap = alert.thresholdSnapshot || {};

  if (alert.type === 'COMPOUND') {
    const profile = (profiles || []).find(
      (p) => p.profileKey === snap.profileKey && p.ruleType === 'compound'
    );
    const cond = (profile && profile.condition) || snap.condition || {};
    const wb = values[alert.parameter];
    const vel = cond.requiresParam ? values[cond.requiresParam] : undefined;
    if (typeof wb !== 'number' || typeof vel !== 'number') return false;
    // Clear when comfortably outside the trigger zone (deadband both sides).
    return wb <= cond.triggerAbove * (1 - DEADBAND) || vel >= cond.min * (1 + DEADBAND);
  }

  // LIMIT (including the air-quantity rule, which is stored as LIMIT/airflow).
  const comparator = snap.comparator || 'MAX';
  const warning = snap.warning;
  const critical = snap.critical;
  if (alert.profileKey === AIR_QTY_PROFILE_KEY || snap.profileKey === AIR_QTY_PROFILE_KEY) {
    const profile = (profiles || []).find((p) => p.profileKey === AIR_QTY_PROFILE_KEY);
    const perPerson = profile && profile.factors && profile.factors.perPerson;
    const perTonne = profile && profile.factors && profile.factors.perTonne;
    if (!perPerson || !perTonne || !district) return false;
    const qRequired = Math.max(
      perPerson * district.personsLargestShift,
      perTonne * district.dailyOutputTonnes
    );
    // Clear when measured is comfortably above required (5% deadband).
    return v >= qRequired * (1 + DEADBAND);
  }
  if (comparator === 'MIN') {
    const ref = warning != null ? warning : critical;
    if (ref == null) return false;
    return v >= ref * (1 + DEADBAND);
  }
  const ref = warning != null ? warning : critical;
  if (ref == null) return false;
  return v <= ref * (1 - DEADBAND);
}

module.exports = {
  evaluateBreaches,
  selectEnabledProfiles,
  selectProfile,
  isClear,
  AIR_QTY_PROFILE_KEY,
  DEADBAND,
};

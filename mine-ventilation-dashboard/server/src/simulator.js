// Correlated control-room simulator (v2).
//
// A real network solve runs every tick (default 3 s):
//   fan affinity (Q ∝ rpm, P ∝ rpm²) → total circuit pressure → parallel/
//   series resistance network → per-branch airflow, velocity, pressure drop
//   → gas dilution physics (CH4 = emission / airflow) → sensor readings.
//
// Everything is stamped server-side with origin: "simulated". RNG is seeded
// (mulberry32, seed 42) so runs are reproducible. Every control mutates real
// state; nothing is faked.
const { Sensor } = require('./models/Sensor');
const { Branch } = require('./models/Branch');
const { Reading } = require('./models/Reading');
const { Fan } = require('./models/Fan');
const { VentilationDoor } = require('./models/VentilationDoor');
const { Regulator } = require('./models/Regulator');
const { SimSnapshot } = require('./models/SimSnapshot');
const { getSettings } = require('./models/Setting');
const { ThresholdProfile } = require('./models/ThresholdProfile');
const alertService = require('./services/alertService');
const realtime = require('./realtime');
const { computeOverallStatus } = require('./sweeper');

const ATM_PA = 101325;
const SNAPSHOT_MS = 10000;
const SCENARIO_MS = 5 * 60 * 1000; // legacy scenarios auto-revert after ~5 min
const SPIKE_AUTO_RECOVER_MS = 3 * 60 * 1000;

const SCENARIOS = ['normal', 'rising CH4', 'fan stop', 'sensor dropout', 'stuck value', 'spike'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(42);

function roundTo(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Network topology (series runs + parallel district splits) and per-branch
// gas/thermal source terms. Resistance R is the base airway resistance
// (Ns²/m⁸); regulators, doors and faults scale it per tick.
// ---------------------------------------------------------------------------
const NETWORK = {
  series1: ['B-SHAFT', 'B-INTAKE', 'B-GALLERY', 'B-RAISE-1', 'B-D1FEED'],
  parallel1: ['B-W1', 'B-W2'],
  series2: ['B-RAISE-2', 'B-D2FEED'],
  parallel2: ['B-W3', 'B-W4'],
  series3: ['B-RETRAISE', 'B-FANDRIFT'],
};

const SEGMENTS = [
  { type: 'series', ids: NETWORK.series1 },
  { type: 'parallel', ids: NETWORK.parallel1 },
  { type: 'series', ids: NETWORK.series2 },
  { type: 'parallel', ids: NETWORK.parallel2 },
  { type: 'series', ids: NETWORK.series3 },
];

// Per-branch source terms for the gas/thermal model.
// gasE: CH4 emission m³/min · baseCOeco: CO source ppm·m³/min · baseCO2: %vol
// baseTempC: °C · heatLoad: arbitrary heat units · dust: mg/m³
const BRANCH_PHYSICS = {
  'B-SHAFT':    { gasE: 0.0, baseCOeco: 0,    baseCO2: 0.03, baseTempC: 24, heatLoad: 0,  dust: 0 },
  'B-INTAKE':   { gasE: 0.1, baseCOeco: 200,  baseCO2: 0.04, baseTempC: 25, heatLoad: 2,  dust: 0 },
  'B-GALLERY':  { gasE: 0.3, baseCOeco: 400,  baseCO2: 0.05, baseTempC: 26, heatLoad: 4,  dust: 0.2 },
  'B-RAISE-1':  { gasE: 0.2, baseCOeco: 200,  baseCO2: 0.05, baseTempC: 26, heatLoad: 2,  dust: 0 },
  'B-D1FEED':   { gasE: 0.5, baseCOeco: 500,  baseCO2: 0.06, baseTempC: 27, heatLoad: 4,  dust: 0.3 },
  'B-W1':       { gasE: 2.0, baseCOeco: 1500, baseCO2: 0.08, baseTempC: 28, heatLoad: 10, dust: 1.2 },
  'B-W2':       { gasE: 3.0, baseCOeco: 2200, baseCO2: 0.10, baseTempC: 29, heatLoad: 12, dust: 1.8 },
  'B-RAISE-2':  { gasE: 0.8, baseCOeco: 600,  baseCO2: 0.08, baseTempC: 28, heatLoad: 3,  dust: 0.4 },
  'B-D2FEED':   { gasE: 1.0, baseCOeco: 800,  baseCO2: 0.10, baseTempC: 29, heatLoad: 5,  dust: 0.5 },
  'B-W3':       { gasE: 4.0, baseCOeco: 2600, baseCO2: 0.12, baseTempC: 30, heatLoad: 14, dust: 2.2 },
  'B-W4':       { gasE: 2.5, baseCOeco: 1800, baseCO2: 0.10, baseTempC: 29, heatLoad: 11, dust: 1.5 },
  'B-RETRAISE': { gasE: 7.0, baseCOeco: 900,  baseCO2: 0.12, baseTempC: 29, heatLoad: 4,  dust: 0.6 },
  'B-FANDRIFT': { gasE: 7.0, baseCOeco: 500,  baseCO2: 0.14, baseTempC: 28, heatLoad: 3,  dust: 0.4 },
};

// Sensors without a branchId fall back to these branches for their readings.
const SENSOR_BRANCH_FALLBACK = { S8: 'B-FANDRIFT' };
// fanRpm on a sensor reflects the effective rpm of the mapped fan.
const SENSOR_FAN = { S7: 'FAN-MAIN', S8: 'FAN-MAIN' };

// ---------------------------------------------------------------------------
// Pure network solve. Input: branchId → { R, area }; fans: [{ P }].
// Output: branchId → { q (m³/s), v (m/s), dp (Pa) }.
// ---------------------------------------------------------------------------
function solveNetwork(branchR, fans) {
  const rOf = (id) => (branchR[id] && branchR[id].R > 0 ? branchR[id].R : Infinity);
  const areaOf = (id) => (branchR[id] && branchR[id].area > 0 ? branchR[id].area : 1);

  const conductance = (ids) => ids.reduce((s, id) => s + 1 / rOf(id), 0);
  const seriesR = (ids) => ids.reduce((s, id) => s + rOf(id), 0);
  const parallelR = (ids) => {
    const g = conductance(ids);
    return g > 0 ? 1 / g : Infinity;
  };

  const rTotal =
    seriesR(NETWORK.series1) + parallelR(NETWORK.parallel1) +
    seriesR(NETWORK.series2) + parallelR(NETWORK.parallel2) +
    seriesR(NETWORK.series3);

  const pTotal = (fans || []).reduce((s, f) => s + (f && f.P > 0 ? f.P : 0), 0);
  const qTotal = rTotal > 0 && rTotal < Infinity && pTotal > 0 ? Math.sqrt(pTotal / rTotal) : 0;

  const out = {};
  const setBranch = (id, q) => {
    const R = rOf(id);
    const dp = R < Infinity ? R * q * q : 0;
    out[id] = { q, v: q / areaOf(id), dp };
  };
  for (const id of [...NETWORK.series1, ...NETWORK.series2, ...NETWORK.series3]) {
    setBranch(id, qTotal);
  }
  for (const ids of [NETWORK.parallel1, NETWORK.parallel2]) {
    const g = conductance(ids);
    for (const id of ids) {
      setBranch(id, g > 0 ? qTotal * (1 / rOf(id)) / g : 0);
    }
  }
  return { branches: out, qTotal, pTotal, rTotal };
}

// Effective branch resistance: regulator opening, door position, fault blockage.
function effectiveResistance(branchId, baseR, regulator, door, blockageFactor) {
  let R = baseR > 0 ? baseR : 0.05;
  if (regulator) {
    const opening = clamp(regulator.openingPct, 5, 100);
    R *= Math.pow(100 / opening, 1.5);
  }
  if (door && door.status === 'CLOSED') {
    R *= 60;
  }
  if (blockageFactor && blockageFactor > 1) {
    R *= blockageFactor;
  }
  return R;
}

// ---------------------------------------------------------------------------
// Simulator state (in-memory; equipment truth lives in Mongo).
// ---------------------------------------------------------------------------
const state = {
  paused: false,
  speed: 1,
  simTime: 0, // simulated seconds
  scenario: 'normal', // legacy scenario name
  scenarioRun: null, // v2 scenario catalog id
  targetSensorId: null,
  startedAt: null,
  revertTimer: null,
  activeFaults: [], // { faultId, targetId, injectedAt, prev, params, timer }
  emissionMult: {}, // branchId → multiplier (methane-spike)
  tempOffsetC: {}, // branchId → °C offset (high-temperature)
  blockage: {}, // branchId → resistance multiplier (pressure-rise)
  stuckSensors: new Set(), // legacy "stuck value" scenario
  commsDown: new Set(), // sensorIds deliberately darkened by a comms fault
  // (sensor-failure / comm-loss / multi-sensor-failure). The tick skips ONLY
  // these — a sensor the sweeper marked STALE/OFFLINE without an active comms
  // fault self-heals on the next tick instead of deadlocking dark forever.
  lastLive: null, // last computed branch live state
  lastKpis: null,
  lastOverall: 'NORMAL',
  defaultFlows: {}, // branchId → Q (m³/s) at seeded defaults (door impact baseline)
  lastSnapshotAt: 0,
  // Pre-fault equipment baselines, captured the first time any fault mutates a
  // fan/sensor. Recovery recomputes equipment state from these baselines plus
  // the *remaining* active faults, so overlapping faults recover correctly.
  fanBaseline: {}, // fanId → { status, rpm, fault }
  sensorBaseline: {}, // sensorId → { status }
  tickMs: 3000,
};

function simError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Fault catalog (12) — every fault is injectable and recoverable.
// ---------------------------------------------------------------------------
const FAULT_CATALOG = [
  {
    faultId: 'main-fan-failure', name: 'Main fan failure', severity: 'CRITICAL',
    description: 'Main exhaust fan trips; the whole circuit loses driving pressure.',
    cause: 'Motor protection trip / power dip at the fan house.',
    affectedBranches: ['B-FANDRIFT', 'B-RETRAISE', 'B-MAINRET'],
    sensorChanges: 'S7/S8 fanRpm → 0; airflow, velocity and pressure collapse across the network; gas concentrations climb as dilution falls.',
    expectedResponse: 'Start standby/aux capacity, evacuate if gas limits are breached, investigate the trip.',
  },
  {
    faultId: 'aux-fan-failure', name: 'Auxiliary fan failure', severity: 'WARNING',
    description: 'A district booster fan trips; its branch loses boost pressure.',
    cause: 'Bearing overheat / belt failure on the booster fan.', target: 'fanId', defaultTarget: 'FAN-AUX-1',
    affectedBranches: ['B-W2'],
    sensorChanges: 'Affected working branch airflow falls; district return gas rises slightly.',
    expectedResponse: 'Inspect the booster fan; rebalance regulators in the district.',
  },
  {
    faultId: 'door-closed', name: 'Ventilation door closed', severity: 'WARNING',
    description: 'A ventilation door is left closed, choking its branch (R × 60).',
    cause: 'Door left shut after vehicle passage; damaged door frame.', target: 'doorId', defaultTarget: 'D-01',
    affectedBranches: ['B-W1'],
    sensorChanges: 'Closed branch flow collapses; parallel branch flow rises; pressure differential spikes.',
    expectedResponse: 'Re-open the door; check the door frame and seals.',
  },
  {
    faultId: 'regulator-changed', name: 'Regulator tampered', severity: 'WARNING',
    description: 'A regulator opening is forced down to 15%.',
    cause: 'Unauthorised adjustment of the regulator shutter.', target: 'regulatorId', defaultTarget: 'R-01',
    affectedBranches: ['B-W1'],
    sensorChanges: 'Branch airflow falls and its pressure loss climbs; sister branch picks up flow.',
    expectedResponse: 'Restore the designed opening; re-survey the district split.',
  },
  {
    faultId: 'sensor-failure', name: 'Sensor failure', severity: 'WARNING',
    description: 'A sensor goes OFFLINE and stops reporting.', target: 'sensorId', defaultTarget: 'S4',
    cause: 'Transducer failure / power loss at the sensor head.',
    affectedBranches: [],
    sensorChanges: 'No readings from the sensor; STALE_COMMS alert raised by the sweeper.',
    expectedResponse: 'Replace / recalibrate the sensor; verify coverage from adjacent stations.',
  },
  {
    faultId: 'methane-spike', name: 'Methane spike', severity: 'CRITICAL',
    description: 'Sudden CH₄ emission surge (×8) on a branch; auto-recovers after 3 min.',
    cause: 'Gas outburst from the face / goaf breakthrough.', target: 'branchId', defaultTarget: 'B-W3',
    affectedBranches: ['B-W3'],
    sensorChanges: 'CH₄ climbs past warning into critical on the branch sensors; rule engine fires LIMIT alerts.',
    expectedResponse: 'Withdraw men, increase airflow to the district, locate the source.',
  },
  {
    faultId: 'airflow-reduction', name: 'Airflow reduction', severity: 'WARNING',
    description: 'Main fan derated to 60% rpm; circuit airflow falls.',
    cause: 'VSD fault / restricted intake at the fan.',
    affectedBranches: ['B-FANDRIFT'],
    sensorChanges: 'All branch airflows fall ~35%; air-quantity margin shrinks toward shortfall.',
    expectedResponse: 'Restore fan speed; verify VSD and intake screens.',
  },
  {
    faultId: 'pressure-rise', name: 'Return airway blockage', severity: 'WARNING',
    description: 'Partial blockage in the main return (R × 3); circuit pressure rises.',
    cause: 'Roof fall debris / water accumulation in the return.',
    affectedBranches: ['B-FANDRIFT'],
    sensorChanges: 'Total airflow falls; fan pressure and return pressure-drop climb.',
    expectedResponse: 'Inspect the return airway; clear the obstruction.',
  },
  {
    faultId: 'high-temperature', name: 'High temperature zones', severity: 'WARNING',
    description: '+8 °C heat load on all working branches.',
    cause: 'Geothermal gradient / diesel equipment heat in a deep panel.',
    affectedBranches: ['B-W1', 'B-W2', 'B-W3', 'B-W4'],
    sensorChanges: 'Dry-bulb and wet-bulb climb on working-place sensors; heat rule may trip.',
    expectedResponse: 'Increase airflow to hot panels; enforce heat-stress work limits.',
  },
  {
    faultId: 'comm-loss', name: 'Telemetry comms loss', severity: 'WARNING',
    description: 'A sensor goes STALE (intermittent link); readings freeze.', target: 'sensorId', defaultTarget: 'S5',
    cause: 'Radio link fade / damaged comms cable.',
    affectedBranches: [],
    sensorChanges: 'Last values freeze on the dashboard; STALE_COMMS alert raised.',
    expectedResponse: 'Restore the link; treat frozen values as suspect.',
  },
  {
    faultId: 'multi-sensor-failure', name: 'Multi-sensor failure', severity: 'CRITICAL',
    description: 'Three gas-monitoring sensors go OFFLINE at once.',
    cause: 'Common power supply failure on the sensor bus.',
    affectedBranches: [],
    sensorChanges: 'S4, S5, S6 stop reporting; gas picture lost for two districts.',
    expectedResponse: 'Restore sensor-bus power; increase manual gas checks meanwhile.',
  },
  {
    faultId: 'power-failure', name: 'Mine power failure', severity: 'CRITICAL',
    description: 'All fans stop; ventilation collapses to zero.',
    cause: 'Surface substation outage.',
    affectedBranches: ['B-FANDRIFT'],
    sensorChanges: 'Every airflow → 0; gas concentrations climb steeply; O₂ sags.',
    expectedResponse: 'Evacuate to surface / refuge chambers; restore power before re-entry.',
  },
];

function catalogEntry(faultId) {
  return FAULT_CATALOG.find((f) => f.faultId === faultId) || null;
}

function activeFault(faultId, targetId) {
  return state.activeFaults.find(
    (f) => f.faultId === faultId && (targetId == null || f.targetId === targetId)
  );
}

// Full serialisation of the active-fault list (drives the UI's active-fault
// cards). Includes the catalogue copy: cause, response, affected branches.
function serializeActiveFaults() {
  return state.activeFaults.map((f) => {
    const entry = catalogEntry(f.faultId) || {};
    return {
      faultId: f.faultId,
      targetId: f.targetId,
      injectedAt: f.injectedAt,
      name: entry.name || f.faultId,
      severity: entry.severity,
      cause: entry.cause,
      description: entry.description,
      response: entry.expectedResponse,
      affected: entry.affectedBranches,
      sensorChanges: entry.sensorChanges,
    };
  });
}

// ---------------------------------------------------------------------------
// Fault-overlap-safe equipment recovery.
// Baselines capture the operator's equipment state before the FIRST fault
// touches it. On any recovery, fan/sensor state is recomputed from baselines
// plus the *remaining* active faults (applied in a fixed priority order), so
// overlapping faults (e.g. main-fan-failure + airflow-reduction) recover
// correctly instead of restoring a stale `prev` snapshot.
// ---------------------------------------------------------------------------
function ensureFanBaseline(fan) {
  if (!state.fanBaseline[fan.fanId]) {
    state.fanBaseline[fan.fanId] = { status: fan.status, rpm: fan.rpm, fault: fan.fault };
  }
}

function ensureSensorBaseline(sensor) {
  if (!state.sensorBaseline[sensor.sensorId]) {
    state.sensorBaseline[sensor.sensorId] = { status: sensor.status };
  }
}

// Remaining active faults that mutate a given fan, in deterministic order.
function fanAffectingFaults(fanId) {
  const order = { 'power-failure': 0, 'main-fan-failure': 1, 'aux-fan-failure': 2, 'airflow-reduction': 3 };
  return state.activeFaults
    .filter((f) => {
      if (f.faultId === 'power-failure') return true;
      if (f.faultId === 'main-fan-failure' && fanId === 'FAN-MAIN') return true;
      if (f.faultId === 'aux-fan-failure' && f.targetId === fanId) return true;
      if (f.faultId === 'airflow-reduction' && fanId === 'FAN-MAIN') return true;
      return false;
    })
    .sort((a, b) => (order[a.faultId] ?? 9) - (order[b.faultId] ?? 9));
}

async function recomputeFanStates() {
  const fanIds = Object.keys(state.fanBaseline);
  if (!fanIds.length) return;
  for (const fanId of fanIds) {
    const fan = await Fan.findOne({ fanId });
    if (!fan) continue;
    const base = state.fanBaseline[fanId];
    const affecting = fanAffectingFaults(fanId);
    if (!affecting.length) {
      // No fault left touching this fan — restore the operator baseline.
      fan.status = base.status; fan.rpm = base.rpm; fan.fault = base.fault;
      delete state.fanBaseline[fanId];
    } else {
      fan.status = base.status; fan.rpm = base.rpm; fan.fault = base.fault;
      for (const f of affecting) {
        if (f.faultId === 'power-failure') { fan.status = 'STOPPED'; fan.fault = 'power-failure'; }
        else if (f.faultId === 'main-fan-failure') { fan.status = 'FAULT'; fan.fault = 'main-fan-failure'; }
        else if (f.faultId === 'aux-fan-failure') { fan.status = 'FAULT'; fan.fault = 'aux-fan-failure'; }
        else if (f.faultId === 'airflow-reduction') {
          fan.rpm = Math.round(fan.ratedRpm * 0.6);
          if (fan.status !== 'FAULT') fan.status = 'RUNNING';
        }
      }
    }
    await fan.save();
  }
}

function sensorAffectingFaults(sensorId) {
  return state.activeFaults.filter((f) => {
    if (f.faultId === 'sensor-failure' && f.targetId === sensorId) return true;
    if (f.faultId === 'comm-loss' && f.targetId === sensorId) return true;
    if (f.faultId === 'multi-sensor-failure') {
      const ids = Array.isArray(f.targetId) ? f.targetId : ['S4', 'S5', 'S6'];
      return ids.includes(sensorId);
    }
    return false;
  });
}

async function recomputeSensorStates() {
  const sensorIds = Object.keys(state.sensorBaseline);
  if (!sensorIds.length) return;
  for (const sensorId of sensorIds) {
    const sensor = await Sensor.findOne({ sensorId });
    if (!sensor) continue;
    const base = state.sensorBaseline[sensorId];
    const affecting = sensorAffectingFaults(sensorId);
    if (!affecting.length) {
      sensor.status = 'ONLINE';
      await sensor.save();
      state.commsDown.delete(sensorId);
      await alertService.resolveCommsAlerts(sensor.toObject());
      delete state.sensorBaseline[sensorId];
    } else {
      // Highest-priority remaining fault wins: OFFLINE beats STALE.
      const offline = affecting.some((f) => f.faultId === 'sensor-failure' || f.faultId === 'multi-sensor-failure');
      const st = offline ? 'OFFLINE' : 'STALE';
      sensor.status = st;
      await sensor.save();
      state.commsDown.add(sensorId);
      await alertService.raiseCommsAlert(sensor.toObject(), st);
    }
    realtime.emit('sensor:status', {
      sensorId, status: sensor.status, ts: new Date().toISOString(),
    });
  }
}

// Apply the physical mutation for a fault. Returns { prev } for recovery.
async function applyFaultMutation(faultId, targetId) {
  const prev = {};
  switch (faultId) {
    case 'main-fan-failure': {
      const fan = await Fan.findOne({ fanId: 'FAN-MAIN' });
      if (!fan) throw simError(404, 'NOT_FOUND', 'Fan FAN-MAIN not found');
      prev.fan = { status: fan.status, rpm: fan.rpm, fault: fan.fault };
      ensureFanBaseline(fan);
      fan.status = 'FAULT'; fan.fault = faultId;
      await fan.save();
      break;
    }
    case 'aux-fan-failure': {
      const fan = await Fan.findOne({ fanId: targetId });
      if (!fan) throw simError(404, 'NOT_FOUND', `Fan ${targetId} not found`);
      prev.fan = { fanId: fan.fanId, status: fan.status, rpm: fan.rpm, fault: fan.fault };
      ensureFanBaseline(fan);
      fan.status = 'FAULT'; fan.fault = faultId;
      await fan.save();
      break;
    }
    case 'door-closed': {
      const door = await VentilationDoor.findOne({ doorId: targetId });
      if (!door) throw simError(404, 'NOT_FOUND', `Door ${targetId} not found`);
      prev.door = { doorId: door.doorId, status: door.status, positionPct: door.positionPct };
      door.status = 'CLOSED'; door.positionPct = 0;
      await door.save();
      break;
    }
    case 'regulator-changed': {
      const reg = await Regulator.findOne({ regulatorId: targetId });
      if (!reg) throw simError(404, 'NOT_FOUND', `Regulator ${targetId} not found`);
      prev.regulator = { regulatorId: reg.regulatorId, openingPct: reg.openingPct };
      reg.openingPct = 15;
      await reg.save();
      break;
    }
    case 'sensor-failure': {
      const sensor = await Sensor.findOne({ sensorId: targetId });
      if (!sensor) throw simError(404, 'NOT_FOUND', `Sensor ${targetId} not found`);
      prev.sensor = { sensorId: sensor.sensorId, status: sensor.status };
      ensureSensorBaseline(sensor);
      sensor.status = 'OFFLINE';
      await sensor.save();
      state.commsDown.add(sensor.sensorId);
      await alertService.raiseCommsAlert(sensor.toObject(), 'OFFLINE');
      break;
    }
    case 'methane-spike': {
      const branch = await Branch.findOne({ branchId: targetId });
      if (!branch) throw simError(404, 'NOT_FOUND', `Branch ${targetId} not found`);
      state.emissionMult[targetId] = 8;
      break;
    }
    case 'airflow-reduction': {
      const fan = await Fan.findOne({ fanId: 'FAN-MAIN' });
      if (!fan) throw simError(404, 'NOT_FOUND', 'Fan FAN-MAIN not found');
      prev.fan = { status: fan.status, rpm: fan.rpm, fault: fan.fault };
      ensureFanBaseline(fan);
      fan.rpm = Math.round(fan.ratedRpm * 0.6);
      if (fan.status !== 'FAULT') fan.status = 'RUNNING';
      await fan.save();
      break;
    }
    case 'pressure-rise': {
      state.blockage['B-FANDRIFT'] = 3;
      break;
    }
    case 'high-temperature': {
      for (const b of ['B-W1', 'B-W2', 'B-W3', 'B-W4']) state.tempOffsetC[b] = 8;
      break;
    }
    case 'comm-loss': {
      const sensor = await Sensor.findOne({ sensorId: targetId });
      if (!sensor) throw simError(404, 'NOT_FOUND', `Sensor ${targetId} not found`);
      prev.sensor = { sensorId: sensor.sensorId, status: sensor.status };
      ensureSensorBaseline(sensor);
      sensor.status = 'STALE';
      await sensor.save();
      state.commsDown.add(sensor.sensorId);
      await alertService.raiseCommsAlert(sensor.toObject(), 'STALE');
      break;
    }
    case 'multi-sensor-failure': {
      const ids = Array.isArray(targetId) ? targetId : ['S4', 'S5', 'S6'];
      prev.sensors = [];
      for (const sid of ids) {
        const sensor = await Sensor.findOne({ sensorId: sid });
        if (!sensor) throw simError(404, 'NOT_FOUND', `Sensor ${sid} not found`);
        prev.sensors.push({ sensorId: sensor.sensorId, status: sensor.status });
        ensureSensorBaseline(sensor);
        sensor.status = 'OFFLINE';
        await sensor.save();
        state.commsDown.add(sensor.sensorId);
        await alertService.raiseCommsAlert(sensor.toObject(), 'OFFLINE');
      }
      break;
    }
    case 'power-failure': {
      prev.fans = [];
      const fans = await Fan.find({});
      for (const fan of fans) {
        prev.fans.push({ fanId: fan.fanId, status: fan.status, rpm: fan.rpm, fault: fan.fault });
        ensureFanBaseline(fan);
        fan.status = 'STOPPED';
        fan.fault = faultId;
        await fan.save();
      }
      break;
    }
    default:
      throw simError(400, 'VALIDATION_ERROR', `Unknown fault "${faultId}"`);
  }
  return prev;
}

// Reverse the mutation recorded in `prev`. Fan and sensor equipment state is
// NOT restored here — after the record is removed, recoverFault recomputes
// it from baselines + remaining active faults (overlap-safe).
async function revertFaultMutation(record) {
  const { faultId, prev } = record;
  switch (faultId) {
    case 'main-fan-failure':
    case 'airflow-reduction':
    case 'aux-fan-failure':
    case 'power-failure':
    case 'sensor-failure':
    case 'comm-loss':
    case 'multi-sensor-failure':
      break; // handled by recomputeFanStates / recomputeSensorStates
    case 'door-closed': {
      const door = await VentilationDoor.findOne({ doorId: prev.door.doorId });
      if (door) {
        door.status = prev.door.status; door.positionPct = prev.door.positionPct;
        await door.save();
      }
      break;
    }
    case 'regulator-changed': {
      const reg = await Regulator.findOne({ regulatorId: prev.regulator.regulatorId });
      if (reg) { reg.openingPct = prev.regulator.openingPct; await reg.save(); }
      break;
    }
    case 'methane-spike': {
      delete state.emissionMult[record.targetId];
      break;
    }
    case 'pressure-rise': {
      delete state.blockage['B-FANDRIFT'];
      break;
    }
    case 'high-temperature': {
      for (const b of ['B-W1', 'B-W2', 'B-W3', 'B-W4']) delete state.tempOffsetC[b];
      break;
    }
    default:
      break;
  }
}

async function injectFault(faultId, targetId, opts = {}) {
  const entry = catalogEntry(faultId);
  if (!entry) throw simError(400, 'VALIDATION_ERROR', `Unknown fault "${faultId}"`);
  const target = targetId != null ? targetId : entry.defaultTarget || null;
  if (activeFault(faultId, target)) {
    throw simError(409, 'CONFLICT', `Fault "${faultId}" already active${target ? ` on ${target}` : ''}`);
  }
  const prev = await applyFaultMutation(faultId, target);
  const record = {
    faultId,
    targetId: target,
    injectedAt: new Date(),
    prev,
    params: opts.params || {},
    timer: null,
  };
  if (faultId === 'methane-spike') {
    const ms = opts.durationMs || SPIKE_AUTO_RECOVER_MS;
    record.timer = setTimeout(() => {
      recoverFault(faultId, target).catch(() => {});
      realtime.emit('fault:auto-recovered', { faultId, targetId: target, ts: new Date().toISOString() });
    }, ms);
    if (record.timer.unref) record.timer.unref();
  }
  state.activeFaults.push(record);
  realtime.emit('fault:injected', {
    faultId, targetId: target, ts: new Date().toISOString(),
    activeFaults: serializeActiveFaults(),
  });
  return { faultId, targetId: target, injectedAt: record.injectedAt };
}

async function recoverFault(faultId, targetId) {
  const matches = state.activeFaults.filter(
    (f) => f.faultId === faultId && (targetId == null || f.targetId === targetId)
  );
  if (!matches.length) {
    throw simError(404, 'NOT_FOUND', `No active fault "${faultId}"${targetId ? ` on ${targetId}` : ''}`);
  }
  const recovered = [];
  for (const record of matches) {
    if (record.timer) clearTimeout(record.timer);
    // Remove FIRST so equipment recompute sees only the remaining faults.
    state.activeFaults = state.activeFaults.filter((f) => f !== record);
    await revertFaultMutation(record);
    recovered.push({ faultId: record.faultId, targetId: record.targetId });
  }
  // Overlap-safe: rebuild fan/sensor state from baselines + remaining faults.
  await recomputeFanStates();
  await recomputeSensorStates();
  realtime.emit('fault:recovered', {
    recovered, ts: new Date().toISOString(),
    activeFaults: serializeActiveFaults(),
  });
  return recovered;
}

async function recoverAllFaults() {
  const ids = [...new Set(state.activeFaults.map((f) => f.faultId))];
  const recovered = [];
  for (const id of ids) {
    recovered.push(...(await recoverFault(id)));
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// Scenario catalog (8 saved scenarios).
// ---------------------------------------------------------------------------
const SCENARIO_CATALOG = [
  {
    scenarioId: 'normal-operation', name: 'Normal operation', severity: 'INFO',
    description: 'All equipment at design duty; no faults injected.',
    initialState: { reset: true }, triggers: [],
    affectedComponents: [],
    expectedResponse: 'Monitor KPIs; no operator action required.',
  },
  {
    scenarioId: 'high-methane', name: 'High methane event', severity: 'CRITICAL',
    description: 'Methane emission surge (×8) on Working Branch 3.',
    initialState: { reset: true, faults: [{ faultId: 'methane-spike', targetId: 'B-W3' }] },
    triggers: ['methane-spike on B-W3'],
    affectedComponents: ['B-W3', 'S5'],
    expectedResponse: 'Withdraw men from the panel; raise district airflow; locate the gas source.',
  },
  {
    scenarioId: 'main-fan-failure', name: 'Main fan failure', severity: 'CRITICAL',
    description: 'Main exhaust fan trips; circuit airflow collapses.',
    initialState: { reset: true, faults: [{ faultId: 'main-fan-failure' }] },
    triggers: ['main-fan-failure'],
    affectedComponents: ['FAN-MAIN', 'B-FANDRIFT', 'S7', 'S8'],
    expectedResponse: 'Start standby capacity; evacuate if gas limits breach.',
  },
  {
    scenarioId: 'low-airflow', name: 'Low airflow', severity: 'WARNING',
    description: 'Main fan derated to 60% rpm; the whole mine runs short of air.',
    initialState: { reset: true, faults: [{ faultId: 'airflow-reduction' }] },
    triggers: ['airflow-reduction'],
    affectedComponents: ['FAN-MAIN'],
    expectedResponse: 'Restore fan speed; check the VSD and intake screens.',
  },
  {
    scenarioId: 'door-failure', name: 'Ventilation door failure', severity: 'WARNING',
    description: 'Ventilation door D-02 left closed, choking Working Branch 2.',
    initialState: { reset: true, faults: [{ faultId: 'door-closed', targetId: 'D-02' }] },
    triggers: ['door-closed on D-02'],
    affectedComponents: ['D-02', 'B-W2'],
    expectedResponse: 'Re-open the door; inspect the frame and seals.',
  },
  {
    scenarioId: 'high-heat', name: 'High heat zones', severity: 'WARNING',
    description: '+8 °C heat load on all working branches.',
    initialState: { reset: true, faults: [{ faultId: 'high-temperature' }] },
    triggers: ['high-temperature'],
    affectedComponents: ['B-W1', 'B-W2', 'B-W3', 'B-W4', 'S5'],
    expectedResponse: 'Raise panel airflow; enforce heat-stress work limits.',
  },
  {
    scenarioId: 'sensor-network-failure', name: 'Sensor network failure', severity: 'CRITICAL',
    description: 'Gas monitors S4, S5 and S6 go OFFLINE together.',
    initialState: { reset: true, faults: [{ faultId: 'multi-sensor-failure' }] },
    triggers: ['multi-sensor-failure'],
    affectedComponents: ['S4', 'S5', 'S6'],
    expectedResponse: 'Restore sensor-bus power; step up manual gas checks.',
  },
  {
    scenarioId: 'multi-fault-emergency', name: 'Multi-fault emergency', severity: 'CRITICAL',
    description: 'Main fan trip + door closed on B-W3 + methane spike on B-W4, together.',
    initialState: {
      reset: true,
      faults: [
        { faultId: 'main-fan-failure' },
        { faultId: 'door-closed', targetId: 'D-03' },
        { faultId: 'methane-spike', targetId: 'B-W4' },
      ],
    },
    triggers: ['main-fan-failure', 'door-closed on D-03', 'methane-spike on B-W4'],
    affectedComponents: ['FAN-MAIN', 'D-03', 'B-W3', 'B-W4', 'S5'],
    expectedResponse: 'Full emergency response: evacuate, restore ventilation, then locate gas source.',
  },
];

function getScenario(id) {
  return SCENARIO_CATALOG.find((s) => s.scenarioId === id) || null;
}

async function runScenario(scenarioId) {
  const sc = getScenario(scenarioId);
  if (!sc) throw simError(404, 'NOT_FOUND', `Scenario "${scenarioId}" not found`);
  await resetInternal();
  const applied = [];
  for (const f of (sc.initialState && sc.initialState.faults) || []) {
    applied.push(await injectFault(f.faultId, f.targetId));
  }
  state.scenarioRun = scenarioId;
  realtime.emit('scenario:run', { scenarioId, applied, ts: new Date().toISOString() });
  return { scenarioId, applied };
}

// ---------------------------------------------------------------------------
// Equipment controls (operator+). Every one persists to Mongo; the tick loop
// picks the new state up on the next tick.
// ---------------------------------------------------------------------------
async function getFan(fanId) {
  const fan = await Fan.findOne({ fanId });
  if (!fan) throw simError(404, 'NOT_FOUND', `Fan ${fanId} not found`);
  return fan;
}

async function setFanRpm(fanId, rpm) {
  const fan = await getFan(fanId);
  const before = fan.toObject();
  const r = Number(rpm);
  if (!Number.isFinite(r) || r < 0 || r > fan.ratedRpm) {
    throw simError(400, 'VALIDATION_ERROR', `rpm must be between 0 and ratedRpm (${fan.ratedRpm})`);
  }
  fan.rpm = Math.round(r);
  await fan.save();
  realtime.emit('fan:updated', fan.toObject());
  return { before, after: fan.toObject() };
}

async function startFan(fanId) {
  const fan = await getFan(fanId);
  const before = fan.toObject();
  fan.status = 'RUNNING';
  fan.fault = null;
  if (!(fan.rpm > 0)) fan.rpm = fan.ratedRpm;
  await fan.save();
  realtime.emit('fan:updated', fan.toObject());
  return { before, after: fan.toObject() };
}

async function stopFan(fanId) {
  const fan = await getFan(fanId);
  const before = fan.toObject();
  fan.status = 'STOPPED';
  await fan.save();
  realtime.emit('fan:updated', fan.toObject());
  return { before, after: fan.toObject() };
}

async function setFanAuto(fanId, enabled) {
  const fan = await getFan(fanId);
  const before = fan.toObject();
  if (typeof enabled !== 'boolean') {
    throw simError(400, 'VALIDATION_ERROR', 'Body must be { enabled: boolean }');
  }
  fan.auto = enabled;
  await fan.save();
  realtime.emit('fan:updated', fan.toObject());
  return { before, after: fan.toObject() };
}

async function setDoorStatus(doorId, status) {
  const door = await VentilationDoor.findOne({ doorId });
  if (!door) throw simError(404, 'NOT_FOUND', `Door ${doorId} not found`);
  const before = door.toObject();
  if (status !== 'OPEN' && status !== 'CLOSED') {
    throw simError(400, 'VALIDATION_ERROR', 'status must be OPEN or CLOSED');
  }
  door.status = status;
  door.positionPct = status === 'OPEN' ? 100 : 0;
  await door.save();
  realtime.emit('door:updated', door.toObject());
  return { before, after: door.toObject() };
}

async function setRegulatorOpening(regulatorId, openingPct, delta) {
  const reg = await Regulator.findOne({ regulatorId });
  if (!reg) throw simError(404, 'NOT_FOUND', `Regulator ${regulatorId} not found`);
  const before = reg.toObject();
  let next;
  if (openingPct != null) next = Number(openingPct);
  else if (delta != null) next = reg.openingPct + Number(delta);
  else throw simError(400, 'VALIDATION_ERROR', 'Provide { openingPct } or { delta }');
  if (!Number.isFinite(next)) throw simError(400, 'VALIDATION_ERROR', 'Invalid opening value');
  next = clamp(Math.round(next), 5, 100);
  reg.openingPct = next;
  await reg.save();
  realtime.emit('regulator:updated', reg.toObject());
  return { before, after: reg.toObject() };
}

// ---------------------------------------------------------------------------
// Per-branch live environment (gas + thermal + pressure) from the solved flow.
// ---------------------------------------------------------------------------
function branchEnvironment(branchId, flow, pressureDown, simTimeSec) {
  const phys = BRANCH_PHYSICS[branchId] || { gasE: 0, baseCOeco: 0, baseCO2: 0.05, baseTempC: 26, heatLoad: 2, dust: 0 };
  const q = Math.max(0, flow.q);
  const qMin = q * 60;
  const em = state.emissionMult[branchId] || 1;
  const tempOff = state.tempOffsetC[branchId] || 0;

  const phase = (branchId.charCodeAt(2) * 7 + branchId.length * 13) % 628 / 100;
  const drift = Math.sin(simTimeSec / 600 + phase);
  const nz = (amp) => (rng() * 2 - 1) * amp;

  const ch4 = clamp((phys.gasE * em) / Math.max(qMin, 1) * 100 + drift * 0.01 + nz(0.008), 0, 5);
  const co = clamp(phys.baseCOeco / Math.max(qMin, 1) + nz(0.15), 0, 500);
  const co2 = clamp(phys.baseCO2 + ch4 * 0.25 + nz(0.008), 0, 2);
  const o2 = clamp(20.9 - 5 / Math.max(q, 0.5) + nz(0.03), 17.5, 20.9);
  const tempC = phys.baseTempC + tempOff + (phys.heatLoad * 60) / Math.max(qMin, 30) + drift * 0.3 + nz(0.15);
  const wetBulbC = tempC - 2.8 + nz(0.12);
  const rhPct = clamp(78 + (tempC - 26) * 1.5 + nz(1.2), 5, 100);
  const dust = Math.max(0, (phys.dust || 0) + nz(0.08));

  return {
    q, v: flow.v, dp: flow.dp,
    qMin, pressurePa: pressureDown,
    ch4: roundTo(ch4, 3), co: roundTo(co, 1), co2: roundTo(co2, 3), o2: roundTo(o2, 2),
    tempC: roundTo(tempC, 2), wetBulbC: roundTo(wetBulbC, 2), rhPct: roundTo(rhPct, 1),
    dust: roundTo(dust, 2),
    status: q < 0.05 ? 'NO_FLOW' : flow.v < 1.0 ? 'LOW_FLOW' : 'NORMAL',
  };
}

function sensorValues(sensor, env, fanEffRpm) {
  const p = sensor.parameters || [];
  const values = {};
  const nz = (amp) => (rng() * 2 - 1) * amp;
  const has = (x) => p.includes(x);
  if (has('airflow')) values.airflow = roundTo(env.qMin + nz(4), 1);
  if (has('velocity')) values.velocity = roundTo(Math.max(0, env.v + nz(0.02)), 3);
  if (has('pressure')) values.pressure = roundTo(env.pressurePa + nz(12), 0);
  if (has('temp')) values.temp = roundTo(env.tempC + nz(0.1), 2);
  if (has('wetBulb')) values.wetBulb = roundTo(env.wetBulbC + nz(0.1), 2);
  if (has('humidity')) values.humidity = roundTo(clamp(env.rhPct + nz(0.8), 0, 100), 1);
  if (has('ch4')) values.ch4 = roundTo(Math.max(0, env.ch4 + nz(0.006)), 3);
  if (has('co2')) values.co2 = roundTo(Math.max(0, env.co2 + nz(0.006)), 3);
  if (has('co')) values.co = roundTo(Math.max(0, env.co + nz(0.1)), 1);
  if (has('o2')) values.o2 = roundTo(clamp(env.o2 + nz(0.02), 0, 21), 2);
  if (has('dust')) values.dust = roundTo(Math.max(0, env.dust + nz(0.05)), 2);
  if (has('fanRpm')) values.fanRpm = Math.round(Math.max(0, fanEffRpm + nz(2)));
  return values;
}

// ---------------------------------------------------------------------------
// The tick: solve the network, stamp readings, run the rule engine.
// ---------------------------------------------------------------------------
async function tick() {
  if (state.paused) return;
  const settings = await getSettings();
  const tickMs = clamp(Number(settings.tickMs) || 3000, 2000, 5000);
  state.tickMs = tickMs;
  state.simTime += (tickMs * state.speed) / 1000;
  const now = new Date();

  const [branches, fans, doors, regulators, sensors] = await Promise.all([
    Branch.find({}).lean(),
    Fan.find({}).lean(),
    VentilationDoor.find({}).lean(),
    Regulator.find({}).lean(),
    Sensor.find({}).lean(),
  ]);

  const doorByBranch = new Map(doors.map((d) => [d.branchId, d]));
  const regByBranch = new Map(regulators.map((r) => [r.branchId, r]));
  const fanById = new Map(fans.map((f) => [f.fanId, f]));

  // Effective resistances + fan pressures (affinity laws).
  const branchR = {};
  for (const b of branches) {
    branchR[b.branchId] = {
      R: effectiveResistance(
        b.branchId,
        b.resistanceNs2m8,
        regByBranch.get(b.branchId),
        doorByBranch.get(b.branchId),
        state.blockage[b.branchId]
      ),
      area: b.area,
    };
  }
  const fanPressures = fans.map((f) => {
    const eff = f.status === 'RUNNING' ? f.rpm : 0;
    const ratio = f.ratedRpm > 0 ? eff / f.ratedRpm : 0;
    return { fanId: f.fanId, P: (f.ratedPressurePa || 0) * ratio * ratio, effRpm: eff };
  });

  const solved = solveNetwork(branchR, fanPressures);

  // Cumulative pressure from the intake portal.
  const pressureDown = {};
  let p = ATM_PA;
  for (const seg of SEGMENTS) {
    if (seg.type === 'series') {
      for (const id of seg.ids) {
        const fl = solved.branches[id];
        if (!fl) continue;
        p -= fl.dp;
        pressureDown[id] = p;
      }
    } else {
      const ids = seg.ids.filter((id) => solved.branches[id]);
      const g = ids.reduce((s, id) => s + 1 / Math.max(branchR[id].R, 1e-9), 0);
      const rPar = g > 0 ? 1 / g : 0;
      const dpGroup = rPar * solved.qTotal * solved.qTotal;
      p -= dpGroup;
      for (const id of ids) pressureDown[id] = p;
    }
  }

  // Branch live environments.
  const live = {};
  for (const b of branches) {
    const fl = solved.branches[b.branchId];
    if (!fl) continue;
    live[b.branchId] = branchEnvironment(b.branchId, fl, pressureDown[b.branchId] || ATM_PA, state.simTime);
  }
  state.lastLive = live;

  // KPIs for the compact map event.
  const vals = Object.values(live);
  const maxOf = (f) => (vals.length ? Math.max(...vals.map(f)) : null);
  const minOf = (f) => (vals.length ? Math.min(...vals.map(f)) : null);
  const kpis = {
    airQuantityM3min: roundTo(solved.qTotal * 60, 1),
    velocityMs: roundTo(minOf((e) => e.v) || 0, 3),
    ch4Pct: maxOf((e) => e.ch4),
    co2Pct: maxOf((e) => e.co2),
    coPpm: maxOf((e) => e.co),
    o2Pct: minOf((e) => e.o2),
    tempC: maxOf((e) => e.tempC),
    wetBulbC: maxOf((e) => e.wetBulbC),
    rhPct: maxOf((e) => e.rhPct),
    pressurePa: roundTo(minOf((e) => e.pressurePa) || ATM_PA, 0),
  };
  state.lastKpis = kpis;

  // Sensor readings from live branch state. Sensors deliberately darkened by an
  // active comms fault (state.commsDown) are skipped entirely — no fabricated
  // readings. A sensor that is STALE/OFFLINE for any other reason (e.g. the
  // sweeper marked it during a seed/restart race) self-heals here: the tick
  // resumes writing and flips it back ONLINE instead of deadlocking dark.
  for (const sensor of sensors) {
    if (sensor.status !== 'ONLINE' && state.commsDown.has(sensor.sensorId)) continue;
    const wasDown = sensor.status !== 'ONLINE';
    const branchId = sensor.branchId || SENSOR_BRANCH_FALLBACK[sensor.sensorId];
    const env = live[branchId];
    if (!env) continue;

    let values;
    let quality = 'NORMAL';
    if (state.stuckSensors.has(sensor.sensorId) && sensor.lastReading) {
      values = { ...sensor.lastReading };
      quality = 'STUCK';
    } else {
      const fanId = SENSOR_FAN[sensor.sensorId];
      const effRpm = fanId ? (fanPressures.find((f) => f.fanId === fanId) || {}).effRpm || 0 : 0;
      values = sensorValues(sensor, env, effRpm);
      // S8 is the fan-house motor monitor: its temp tracks the motor.
      if (sensor.sensorId === 'S8' && (sensor.parameters || []).includes('temp')) {
        const fan = fanById.get('FAN-MAIN');
        const ratio = fan && fan.ratedRpm > 0 ? (fan.status === 'RUNNING' ? fan.rpm / fan.ratedRpm : 0) : 0;
        values.temp = roundTo(30 + 6 * ratio + (rng() * 2 - 1) * 0.2, 2);
      }
      if ((state.emissionMult[branchId] || 1) > 1) quality = 'SPIKE';
    }

    const derived = [];
    if ((sensor.parameters || []).includes('velocity') && (sensor.parameters || []).includes('airflow')) {
      derived.push({ parameter: 'velocity', expression: 'Q/60/A' });
    }

    const reading = {
      sensorId: sensor.sensorId,
      measuredAt: now,
      receivedAt: new Date(),
      origin: 'simulated', // always stamped server-side
      values,
      derived,
      quality,
    };
    try {
      await Reading.create(reading);
    } catch (e) {
      if (e.code !== 11000) throw e; // duplicate tick — skip
    }
    await Sensor.updateOne(
      { sensorId: sensor.sensorId },
      { $set: { lastReading: values, lastSeenAt: now, ...(wasDown ? { status: 'ONLINE' } : {}) } }
    );
    if (wasDown) {
      await alertService.resolveCommsAlerts({ sensorId: sensor.sensorId });
      realtime.emit('sensor:status', {
        sensorId: sensor.sensorId, status: 'ONLINE', ts: now.toISOString(),
      });
    }
    await alertService.processReading(reading, sensor);
    realtime.emit('reading:update', {
      sensorId: sensor.sensorId,
      measuredAt: now.toISOString(),
      values,
      quality,
    });
  }

  // Live equipment fields in Mongo (fan affinity duty, door/regulator impact).
  const simHours = (tickMs * state.speed) / 3600000;
  for (const f of fans) {
    const eff = f.status === 'RUNNING' ? f.rpm : 0;
    const ratio = f.ratedRpm > 0 ? eff / f.ratedRpm : 0;
    const running = f.status === 'RUNNING';
    const branchFlow = f.kind === 'main' ? solved.qTotal : (live[f.branchId] ? live[f.branchId].q : 0);
    await Fan.updateOne(
      { fanId: f.fanId },
      {
        $set: {
          // A stopped/faulted fan moves no air and draws no power — show that
          // honestly instead of the circuit flow passing through its branch.
          airflowM3min: running ? roundTo(branchFlow * 60, 1) : 0,
          pressurePa: roundTo((f.ratedPressurePa || 0) * ratio * ratio, 0),
          efficiencyPct: eff > 0 ? roundTo(75 * (0.7 + 0.3 * ratio), 1) : 0,
        },
        $inc: { runtimeHours: f.status === 'RUNNING' ? simHours : 0 },
      }
    );
  }
  for (const d of doors) {
    const env = live[d.branchId];
    const qDef = state.defaultFlows[d.branchId];
    const impact = env && qDef > 0 ? roundTo(((env.q - qDef) / qDef) * 100, 1) : 0;
    await VentilationDoor.updateOne(
      { doorId: d.doorId },
      { $set: { pressureDiffPa: roundTo(env ? env.dp : 0, 0), airflowImpactPct: impact } }
    );
  }
  for (const r of regulators) {
    const env = live[r.branchId];
    await Regulator.updateOne(
      { regulatorId: r.regulatorId },
      {
        $set: {
          resistanceNs2m8: roundTo(branchR[r.branchId] ? branchR[r.branchId].R : 0, 4),
          pressureLossPa: roundTo(env ? env.dp : 0, 0),
          airflowM3min: roundTo(env ? env.qMin : 0, 1),
        },
      }
    );
  }

  const overallStatus = await computeOverallStatus();
  state.lastOverall = overallStatus;

  // One compact event per tick for the map.
  realtime.emit('sim:tick', {
    simTime: Math.round(state.simTime),
    running: true,
    paused: state.paused,
    speed: state.speed,
    kpis,
    // Normalize branch flow to m³/min for consumers (internal q is m³/s).
    branches: Object.fromEntries(
      Object.entries(live).map(([id, e]) => [id, { ...e, q: e.qMin }])
    ),
    fans: fans.map((f) => ({
      fanId: f.fanId,
      status: f.status,
      rpm: f.status === 'RUNNING' ? f.rpm : 0,
      airflowM3min: f.status === 'RUNNING'
        ? roundTo((f.kind === 'main' ? solved.qTotal : (live[f.branchId] ? live[f.branchId].q : 0)) * 60, 1)
        : 0,
    })),
    doors: doors.map((d) => ({ doorId: d.doorId, status: d.status, positionPct: d.positionPct })),
    regulators: regulators.map((r) => ({ regulatorId: r.regulatorId, openingPct: r.openingPct })),
    overallStatus,
    activeFaults: serializeActiveFaults(),
  });

  // Snapshot every 10 s wall-clock while running and unpaused.
  if (now.getTime() - state.lastSnapshotAt >= SNAPSHOT_MS) {
    state.lastSnapshotAt = now.getTime();
    await writeSnapshot(overallStatus).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[simulator] snapshot failed:', e.message);
    });
  }
}

async function writeSnapshot(overallStatus) {
  const overall = overallStatus || (await computeOverallStatus());
  const live = state.lastLive || {};
  const branches = {};
  for (const [id, e] of Object.entries(live)) {
    branches[id] = {
      q: roundTo(e.qMin, 1),
      v: roundTo(e.v, 3),
      dp: roundTo(e.dp, 0),
      status: e.status,
    };
  }
  const [fans, doors, regulators] = await Promise.all([
    Fan.find({}).lean(),
    VentilationDoor.find({}).lean(),
    Regulator.find({}).lean(),
  ]);
  const snap = await SimSnapshot.create({
    ts: new Date(),
    simTime: Math.round(state.simTime),
    overallStatus: overall,
    kpis: state.lastKpis || {},
    branches,
    fans: Object.fromEntries(
      fans.map((f) => [f.fanId, { rpm: f.status === 'RUNNING' ? f.rpm : 0, status: f.status, airflowM3min: f.airflowM3min, pressurePa: f.pressurePa }])
    ),
    doors: Object.fromEntries(
      doors.map((d) => [d.doorId, { status: d.status, positionPct: d.positionPct, pressureDiffPa: d.pressureDiffPa }])
    ),
    regulators: Object.fromEntries(
      regulators.map((r) => [r.regulatorId, { openingPct: r.openingPct, resistanceNs2m8: r.resistanceNs2m8 }])
    ),
    activeFaults: serializeActiveFaults(),
  });
  return snap;
}

async function getSnapshots(from, to, limit) {
  const filter = {};
  if (from || to) {
    filter.ts = {};
    if (from) filter.ts.$gte = new Date(from);
    if (to) filter.ts.$lte = new Date(to);
  }
  return SimSnapshot.find(filter).sort({ ts: -1 }).limit(Math.min(limit || 200, 500)).lean();
}

async function getSnapshotAt(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw simError(400, 'VALIDATION_ERROR', 'Invalid "at" timestamp');
  return SimSnapshot.findOne({ ts: { $lte: d } }).sort({ ts: -1 }).lean();
}

// ---------------------------------------------------------------------------
// Required airflow Q_required = max(perPerson·persons, perTonne·tonnes).
// Factors come from the enabled TP-AIRQTY-FACTORS profile (CMR 2017 Reg.
// 153(2)(a)) — never hard-coded; persons/tonnes come from Settings.
// ---------------------------------------------------------------------------
async function requiredAirflow() {
  const settings = await getSettings();
  const profile = await ThresholdProfile.findOne({ profileKey: 'TP-AIRQTY-FACTORS', enabled: true })
    .sort({ version: -1 })
    .lean();
  const perPerson = profile && profile.factors ? profile.factors.perPerson : null;
  const perTonne = profile && profile.factors ? profile.factors.perTonne : null;
  if (perPerson == null || perTonne == null) {
    return { qRequired: null, reason: 'TP-AIRQTY-FACTORS profile not available' };
  }
  const persons = settings.persons;
  const tonnes = settings.dailyProductionTonnes;
  const qByPersons = perPerson * persons;
  const qByOutput = perTonne * tonnes;
  return {
    qRequired: Math.max(qByPersons, qByOutput),
    qByPersons,
    qByOutput,
    perPerson,
    perTonne,
    persons,
    dailyProductionTonnes: tonnes,
    sourceRef: profile.sourceRef,
    unit: 'm³/min',
  };
}

async function getStatus() {
  const settings = await getSettings();
  const qreq = await requiredAirflow();
  return {
    running: timer != null,
    paused: state.paused,
    speed: state.speed,
    simTime: Math.round(state.simTime),
    tickMs: clamp(Number(settings.tickMs) || 3000, 2000, 5000),
    scenario: state.scenario,
    scenarioRun: state.scenarioRun,
    targetSensorId: state.targetSensorId,
    startedAt: state.startedAt,
    activeFaults: serializeActiveFaults(),
    overallStatus: state.lastOverall,
    requiredAirflow: qreq,
    mineName: settings.mineName,
  };
}

function getLiveBranches() {
  return state.lastLive;
}

// ---------------------------------------------------------------------------
// Legacy scenarios (v1 API): mapped onto the fault/state machinery.
// ---------------------------------------------------------------------------
function clearRevertTimer() {
  if (state.revertTimer) clearTimeout(state.revertTimer);
  state.revertTimer = null;
}

async function setScenario(scenario, targetSensorId) {
  if (!SCENARIOS.includes(scenario)) {
    throw simError(400, 'VALIDATION_ERROR', `Unknown scenario "${scenario}"`);
  }
  clearRevertTimer();
  await recoverAllFaults().catch(() => {});
  state.stuckSensors.clear();
  state.scenario = scenario;
  state.scenarioRun = null;
  state.targetSensorId = targetSensorId || null;
  state.startedAt = scenario === 'normal' ? null : new Date();
  rng = mulberry32(42); // reseed so every scenario run is reproducible

  if (scenario !== 'normal') {
    const target = targetSensorId || null;
    if (scenario === 'rising CH4') {
      const sensor = target ? await Sensor.findOne({ sensorId: target }).lean() : null;
      const branchId = (sensor && sensor.branchId) || 'B-W3';
      await injectFault('methane-spike', branchId, { durationMs: SCENARIO_MS });
    } else if (scenario === 'fan stop') {
      await injectFault('main-fan-failure');
    } else if (scenario === 'sensor dropout') {
      await injectFault('comm-loss', target || 'S4');
    } else if (scenario === 'stuck value') {
      state.stuckSensors.add(target || 'S4');
    } else if (scenario === 'spike') {
      const sensor = target ? await Sensor.findOne({ sensorId: target }).lean() : null;
      const branchId = (sensor && sensor.branchId) || 'B-W3';
      await injectFault('methane-spike', branchId, { durationMs: 90 * 1000 });
    }
    state.revertTimer = setTimeout(() => {
      setScenario('normal').catch(() => {});
      realtime.emit('system:status', { overallStatus: state.lastOverall, serverTime: new Date().toISOString(), note: 'scenario auto-reverted to normal' });
    }, SCENARIO_MS);
    if (state.revertTimer.unref) state.revertTimer.unref();
  }
  return { scenario: state.scenario, targetSensorId: state.targetSensorId, startedAt: state.startedAt };
}

// ---------------------------------------------------------------------------
// Transport controls.
// ---------------------------------------------------------------------------
let timer = null;

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    tick().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[simulator] tick failed:', e.message);
    });
  }, state.tickMs);
  if (timer.unref) timer.unref();
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function pause() {
  stopTimer();
  state.paused = true;
  return { paused: true };
}

function resume() {
  state.paused = false;
  startTimer();
  return { paused: false };
}

function setSpeed(speed) {
  const s = Number(speed);
  if (![1, 2, 5, 10].includes(s)) {
    throw simError(400, 'VALIDATION_ERROR', 'speed must be one of 1|2|5|10');
  }
  state.speed = s;
  return { speed: s };
}

// Compute seeded-default branch flows (all fans at rated duty, doors open,
// regulators at seed opening, no faults) — the baseline for door impact %.
async function computeDefaultFlows() {
  const [branches, fans, regulators] = await Promise.all([
    Branch.find({}).lean(),
    Fan.find({}).lean(),
    Regulator.find({}).lean(),
  ]);
  if (!branches.length || !fans.length) return {};
  const regByBranch = new Map(regulators.map((r) => [r.branchId, r]));
  const branchR = {};
  for (const b of branches) {
    branchR[b.branchId] = {
      R: effectiveResistance(b.branchId, b.resistanceNs2m8, regByBranch.get(b.branchId), { status: 'OPEN' }, null),
      area: b.area,
    };
  }
  const fanPressures = fans.map((f) => ({
    P: (f.ratedPressurePa || 0),
  }));
  const solved = solveNetwork(branchR, fanPressures);
  const flows = {};
  for (const [id, fl] of Object.entries(solved.branches)) flows[id] = fl.q;
  return flows;
}

async function resetInternal() {
  for (const f of state.activeFaults) {
    if (f.timer) clearTimeout(f.timer);
  }
  clearRevertTimer();
  state.activeFaults = [];
  state.emissionMult = {};
  state.tempOffsetC = {};
  state.blockage = {};
  state.fanBaseline = {};
  state.sensorBaseline = {};
  state.stuckSensors.clear();
  state.commsDown.clear();
  state.scenario = 'normal';
  state.scenarioRun = null;
  state.targetSensorId = null;
  state.startedAt = null;
  state.simTime = 0;
  rng = mulberry32(42);

  // Restore equipment to seed defaults.
  const fans = await Fan.find({});
  for (const fan of fans) {
    fan.status = 'RUNNING';
    fan.rpm = fan.ratedRpm;
    fan.fault = null;
    await fan.save();
  }
  const doors = await VentilationDoor.find({});
  for (const door of doors) {
    door.status = 'OPEN';
    door.positionPct = 100;
    await door.save();
  }
  const regs = await Regulator.find({});
  for (const reg of regs) {
    reg.openingPct = 70;
    await reg.save();
  }
  await Sensor.updateMany({}, { $set: { status: 'ONLINE', lastSeenAt: new Date() } });
  state.defaultFlows = await computeDefaultFlows();
}

async function reset() {
  await resetInternal();
  realtime.emit('simulator:reset', { ts: new Date().toISOString(), simTime: 0 });
  return { reset: true, simTime: 0 };
}

function applyTickMs(ms) {
  const clamped = clamp(Number(ms) || 3000, 2000, 5000);
  state.tickMs = clamped;
  if (timer && !state.paused) startTimer(); // restart with the new cadence
}

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
async function start() {
  if (timer) return;
  rng = mulberry32(42);
  const settings = await getSettings().catch(() => ({ tickMs: 3000 }));
  state.tickMs = clamp(Number(settings.tickMs) || 3000, 2000, 5000);
  state.defaultFlows = await computeDefaultFlows().catch(() => ({}));
  startTimer();
  // First tick soon after boot so the dashboard isn't empty.
  setTimeout(() => tick().catch(() => {}), 1500);
}

module.exports = {
  start,
  pause,
  resume,
  setSpeed,
  reset,
  tick,
  getStatus,
  // True while a fault deliberately darkens this sensor (sensor-failure /
  // comm-loss / multi-sensor-failure). The sweeper must not "heal" these.
  isCommsDown: (sensorId) => state.commsDown.has(sensorId),
  getLiveBranches,
  requiredAirflow,
  applyTickMs,
  // Faults
  FAULT_CATALOG,
  injectFault,
  recoverFault,
  recoverAllFaults,
  // Scenarios
  SCENARIO_CATALOG,
  runScenario,
  getScenario,
  // Equipment controls
  setFanRpm,
  startFan,
  stopFan,
  setFanAuto,
  setDoorStatus,
  setRegulatorOpening,
  // Snapshots
  writeSnapshot,
  getSnapshots,
  getSnapshotAt,
  // Pure / legacy
  solveNetwork,
  effectiveResistance,
  mulberry32,
  setScenario,
  getScenarioState: () => ({ scenario: state.scenario, targetSensorId: state.targetSensorId }),
  SCENARIOS,
  TICK_MS: 3000,
  NETWORK,
  BRANCH_PHYSICS,
};

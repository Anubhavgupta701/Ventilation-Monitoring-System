'use strict';
// Fault injection → alert → recover → auto-clear, plus snapshot write.
// Isolated: mongodb-memory-server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { Branch } = require('../src/models/Branch');
const { Sensor } = require('../src/models/Sensor');
const { Fan } = require('../src/models/Fan');
const { ThresholdProfile } = require('../src/models/ThresholdProfile');
const { Alert } = require('../src/models/Alert');
const { SimSnapshot } = require('../src/models/SimSnapshot');
const simulator = require('../src/simulator');

let mem;

const BRANCHES = [
  ['B-SHAFT', 0.06, 12], ['B-INTAKE', 0.10, 14], ['B-GALLERY', 0.14, 12],
  ['B-RAISE-1', 0.08, 10], ['B-D1FEED', 0.12, 10], ['B-W1', 0.55, 8],
  ['B-W2', 0.55, 8], ['B-RAISE-2', 0.08, 10], ['B-D2FEED', 0.12, 10],
  ['B-W3', 0.55, 8], ['B-W4', 0.55, 8], ['B-RETRAISE', 0.14, 12], ['B-FANDRIFT', 0.18, 10],
];

before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
  await Branch.insertMany(BRANCHES.map(([branchId, resistanceNs2m8, area]) => ({
    branchId, name: branchId, fromNode: { label: 'a', x: 0, y: 0 },
    toNode: { label: 'b', x: 1, y: 1 }, area, direction: 'INTAKE',
    resistanceNs2m8, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  })));
  await Fan.insertMany([
    { fanId: 'FAN-MAIN', name: 'Main exhaust fan', kind: 'main', branchId: 'B-FANDRIFT', level: 'L-4', status: 'RUNNING', rpm: 1450, ratedRpm: 1450, ratedPressurePa: 1800, ratedAirflowM3min: 2350, powerKw: 110, auto: true },
    { fanId: 'FAN-AUX-1', name: 'Aux 1', kind: 'aux', branchId: 'B-W2', level: 'L-2', status: 'RUNNING', rpm: 960, ratedRpm: 960, ratedPressurePa: 600, ratedAirflowM3min: 1170, powerKw: 30, auto: true },
    { fanId: 'FAN-AUX-2', name: 'Aux 2', kind: 'aux', branchId: 'B-W4', level: 'L-3', status: 'RUNNING', rpm: 960, ratedRpm: 960, ratedPressurePa: 600, ratedAirflowM3min: 1170, powerKw: 30, auto: true },
  ]);
  await Sensor.create({
    sensorId: 'S5', name: 'S5 gas', locationType: 'WORKING_PLACE', level: 'L-3',
    branchId: 'B-W3', parameters: ['ch4', 'co2', 'co', 'o2'],
    location: { lat: 22, lng: 84 }, mapPosition: { x: 0, y: 0 }, status: 'ONLINE',
  });
  await ThresholdProfile.create({
    profileKey: 'TP-CH4-ANY', name: 'CH4 limit', parameter: 'ch4',
    locationType: 'ANY_PLACE', comparator: 'MAX', warning: 1.0, critical: 1.25,
    unit: '%vol', ruleType: 'limit', version: 1, enabled: true,
    sourceRef: 'CMR 2017 Reg. 153(2)(c)',
  });
});

after(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

test('sweeper-marked OFFLINE self-heals on tick; injected comms fault stays dark', async () => {
  const { Reading } = require('../src/models/Reading');

  // Simulate the sweeper having marked S5 OFFLINE with no active comms fault
  // (e.g. a seed/restart race): the next tick must heal it, not deadlock.
  const alertService = require('../src/services/alertService');
  await Sensor.updateOne({ sensorId: 'S5' }, { $set: { status: 'OFFLINE', lastSeenAt: null } });
  await alertService.raiseCommsAlert({ sensorId: 'S5' }, 'OFFLINE');
  await simulator.tick();
  let s5 = await Sensor.findOne({ sensorId: 'S5' }).lean();
  assert.equal(s5.status, 'ONLINE', 'sweeper-marked OFFLINE must self-heal');
  assert.ok(s5.lastSeenAt, 'lastSeenAt refreshed');
  const healed = await Alert.find({
    sensorId: 'S5', parameter: 'comms', type: 'STALE_COMMS',
  }).lean();
  assert.ok(healed.length >= 1, 'comms alert was raised');
  assert.ok(healed.every((a) => a.status === 'RESOLVED'), 'comms alerts resolved on heal');

  // A genuine injected comms fault must keep the sensor dark (no fabricated readings).
  const before = await Reading.countDocuments({ sensorId: 'S5' });
  await simulator.injectFault('sensor-failure', 'S5');
  await simulator.tick();
  s5 = await Sensor.findOne({ sensorId: 'S5' }).lean();
  assert.equal(s5.status, 'OFFLINE', 'injected fault keeps sensor dark');
  const after = await Reading.countDocuments({ sensorId: 'S5' });
  assert.equal(after, before, 'no readings fabricated while comms fault is active');

  await simulator.recoverFault('sensor-failure', 'S5');
  await simulator.tick();
  s5 = await Sensor.findOne({ sensorId: 'S5' }).lean();
  assert.equal(s5.status, 'ONLINE', 'sensor back ONLINE after fault recovery');
});

test('fault inject → alert fires; recover → clears after normal ticks; snapshot written', async () => {
  // baseline: a tick with normal gas → no CH4 alerts
  await simulator.tick();
  let alerts = await Alert.find({ sensorId: 'S5', parameter: 'ch4' });
  assert.equal(alerts.length, 0, 'no CH4 alert under normal duty');

  // inject methane-spike on B-W3 → next tick must breach
  await simulator.injectFault('methane-spike', 'B-W3', { durationMs: 60000 });
  await simulator.tick();
  alerts = await Alert.find({ sensorId: 'S5', parameter: 'ch4' });
  assert.equal(alerts.length, 1, 'spiked CH4 must raise an alert');
  assert.equal(alerts[0].severity, 'CRITICAL');
  assert.equal(alerts[0].status, 'ACTIVE');
  const s5 = await Sensor.findOne({ sensorId: 'S5' }).lean();
  assert.ok(s5.lastReading.ch4 > 1.25, `S5 ch4 spiked (${s5.lastReading.ch4}%)`);

  // recover → 3 consecutive normal ticks → auto-resolved
  await simulator.recoverFault('methane-spike');
  for (let i = 0; i < 3; i++) await simulator.tick();
  const resolved = await Alert.findOne({ sensorId: 'S5', parameter: 'ch4' }).lean();
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.resolution, 'auto-resolved');

  // snapshot was written by the tick loop
  const snaps = await SimSnapshot.countDocuments();
  assert.ok(snaps >= 1, 'sim snapshot written');
  const snap = await SimSnapshot.findOne({}).sort({ ts: -1 }).lean();
  assert.ok(snap.branches && snap.branches['B-W3'], 'snapshot carries branch flows');
  assert.ok(snap.fans && snap.fans['FAN-MAIN'], 'snapshot carries fan state');
});

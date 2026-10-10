// Idempotent seed: clears and reseeds all collections.
// Usage: npm run seed   (requires MongoDB on MONGO_URI, e.g. via `npm run mongo`)
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { User } = require('./models/User');
const { Sensor } = require('./models/Sensor');
const { Branch } = require('./models/Branch');
const { District } = require('./models/District');
const { Reading } = require('./models/Reading');
const { ThresholdProfile } = require('./models/ThresholdProfile');
const { Alert } = require('./models/Alert');
const { AuditLog } = require('./models/AuditLog');
const { Fan } = require('./models/Fan');
const { VentilationDoor } = require('./models/VentilationDoor');
const { Regulator } = require('./models/Regulator');
const { SimSnapshot } = require('./models/SimSnapshot');
const { Setting } = require('./models/Setting');

const VERIFY_NOTE = 'verified via secondary source — cross-check pending';
const SOURCE_DATE = new Date('2017-11-27'); // CMR 2017 notification

async function seed() {
  await mongoose.connect(config.MONGO_URI);

  // Clear everything for a reproducible demo state.
  await Promise.all([
    User.deleteMany({}),
    Sensor.deleteMany({}),
    Branch.deleteMany({}),
    District.deleteMany({}),
    Reading.deleteMany({}),
    ThresholdProfile.deleteMany({}),
    Alert.deleteMany({}),
    AuditLog.deleteMany({}),
    Fan.deleteMany({}),
    VentilationDoor.deleteMany({}),
    Regulator.deleteMany({}),
    Setting.deleteMany({}),
  ]);
  // Drop the capped snapshots collection so it is recreated with capped options.
  try {
    await mongoose.connection.db.dropCollection('simsnapshots');
  } catch (e) {
    if (e.codeName !== 'NamespaceNotFound') throw e;
  }
  // Touch the model so the capped collection is created eagerly.
  await SimSnapshot.createCollection().catch(() => {});

  // ---- Users (bcrypt-hashed) ----
  const users = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'ventoff', password: 'ventoff123', role: 'officer' },
    { username: 'operator', password: 'op123', role: 'operator' },
    { username: 'viewer', password: 'view123', role: 'viewer' },
  ];
  for (const u of users) {
    await User.create({
      username: u.username,
      passwordHash: await bcrypt.hash(u.password, 10),
      role: u.role,
      active: true,
    });
  }

  // ---- Branches: multi-level network L-1..L-4 (SVG viewBox 0 0 1000 600) ----
  // L-1: shaft → main intake → main gallery → downcast raise
  // L-2: district 1 feed → 2 parallel working branches (B-W1/B-W2)
  // L-3: district 2 feed → 2 parallel working branches (B-W3/B-W4)
  // L-4: return raise → fan drift → FAN-MAIN at the fan house
  const branches = [
    { branchId: 'B-SHAFT', name: 'Intake Shaft', direction: 'INTAKE', area: 16, level: 'L-1',
      resistanceNs2m8: 0.06, lengthM: 120, districtId: 'D1',
      fromNode: { label: 'Shaft collar', x: 60, y: 120 }, toNode: { label: 'Shaft bottom', x: 180, y: 120 } },
    { branchId: 'B-INTAKE', name: 'Main Intake Airway', direction: 'INTAKE', area: 14, level: 'L-1',
      resistanceNs2m8: 0.10, lengthM: 180, districtId: 'D1',
      fromNode: { label: 'Shaft bottom', x: 180, y: 120 }, toNode: { label: 'Junction J1', x: 360, y: 120 } },
    { branchId: 'B-GALLERY', name: 'Main Gallery', direction: 'INTAKE', area: 12, level: 'L-1',
      resistanceNs2m8: 0.14, lengthM: 160, districtId: 'D1',
      fromNode: { label: 'Junction J1', x: 360, y: 120 }, toNode: { label: 'Downcast junction', x: 520, y: 120 } },
    { branchId: 'B-RAISE-1', name: 'Downcast Raise to L-2', direction: 'INTAKE', area: 10, level: 'L-1',
      resistanceNs2m8: 0.08, lengthM: 120, districtId: 'D1',
      fromNode: { label: 'Downcast junction', x: 520, y: 120 }, toNode: { label: 'L-2 landing', x: 520, y: 240 } },
    { branchId: 'B-D1FEED', name: 'District 1 Feed Airway', direction: 'INTAKE', area: 10, level: 'L-2',
      resistanceNs2m8: 0.12, lengthM: 160, districtId: 'D1',
      fromNode: { label: 'L-2 landing', x: 520, y: 240 }, toNode: { label: 'District 1 split', x: 360, y: 240 } },
    { branchId: 'B-W1', name: 'Working Branch 1 (LVC)', direction: 'INTAKE', area: 8, level: 'L-2',
      resistanceNs2m8: 0.55, lengthM: 280, districtId: 'D1', isLastVentilationConnection: true,
      stoppings: [{ label: 'Stopping S-A', atPct: 55 }],
      fromNode: { label: 'District 1 split', x: 360, y: 240 }, toNode: { label: 'Return junction R1', x: 640, y: 240 },
      path: [{ x: 360, y: 240 }, { x: 500, y: 205 }, { x: 640, y: 240 }] },
    { branchId: 'B-W2', name: 'Working Branch 2', direction: 'INTAKE', area: 8, level: 'L-2',
      resistanceNs2m8: 0.55, lengthM: 280, districtId: 'D1',
      stoppings: [{ label: 'Stopping S-B', atPct: 60 }],
      fromNode: { label: 'District 1 split', x: 360, y: 240 }, toNode: { label: 'Return junction R1', x: 640, y: 240 },
      path: [{ x: 360, y: 240 }, { x: 500, y: 275 }, { x: 640, y: 240 }] },
    { branchId: 'B-RAISE-2', name: 'Downcast Raise to L-3', direction: 'INTAKE', area: 10, level: 'L-2',
      resistanceNs2m8: 0.08, lengthM: 120, districtId: 'D2',
      fromNode: { label: 'Return junction R1', x: 640, y: 240 }, toNode: { label: 'L-3 landing', x: 640, y: 360 } },
    { branchId: 'B-D2FEED', name: 'District 2 Feed Airway', direction: 'INTAKE', area: 10, level: 'L-3',
      resistanceNs2m8: 0.12, lengthM: 160, districtId: 'D2',
      fromNode: { label: 'L-3 landing', x: 640, y: 360 }, toNode: { label: 'District 2 split', x: 360, y: 360 } },
    { branchId: 'B-W3', name: 'Working Branch 3 (LVC)', direction: 'INTAKE', area: 8, level: 'L-3',
      resistanceNs2m8: 0.55, lengthM: 280, districtId: 'D2', isLastVentilationConnection: true,
      stoppings: [{ label: 'Stopping S-C', atPct: 50 }],
      fromNode: { label: 'District 2 split', x: 360, y: 360 }, toNode: { label: 'Return junction R2', x: 640, y: 360 },
      path: [{ x: 360, y: 360 }, { x: 500, y: 325 }, { x: 640, y: 360 }] },
    { branchId: 'B-W4', name: 'Working Branch 4', direction: 'INTAKE', area: 8, level: 'L-3',
      resistanceNs2m8: 0.55, lengthM: 280, districtId: 'D2',
      stoppings: [{ label: 'Stopping S-D', atPct: 65 }],
      fromNode: { label: 'District 2 split', x: 360, y: 360 }, toNode: { label: 'Return junction R2', x: 640, y: 360 },
      path: [{ x: 360, y: 360 }, { x: 500, y: 395 }, { x: 640, y: 360 }] },
    { branchId: 'B-RETRAISE', name: 'Main Return Raise', direction: 'RETURN', area: 10, level: 'L-4',
      resistanceNs2m8: 0.14, lengthM: 120, districtId: 'D2',
      fromNode: { label: 'Return junction R2', x: 640, y: 360 }, toNode: { label: 'Fan drift entry', x: 640, y: 480 } },
    { branchId: 'B-FANDRIFT', name: 'Fan Drift', direction: 'RETURN', area: 6, level: 'L-4',
      resistanceNs2m8: 0.18, lengthM: 180, districtId: 'D2',
      fromNode: { label: 'Fan drift entry', x: 640, y: 480 }, toNode: { label: 'Fan house', x: 820, y: 480 } },
  ];
  for (const b of branches) {
    await Branch.create({
      ...b,
      path: b.path || [{ x: b.fromNode.x, y: b.fromNode.y }, { x: b.toNode.x, y: b.toNode.y }],
    });
  }

  // ---- Districts ----
  await District.create([
    { districtId: 'D1', name: 'District A', personsLargestShift: 120, dailyOutputTonnes: 400, lastConnectionBranchId: 'B-W1' },
    { districtId: 'D2', name: 'District B', personsLargestShift: 250, dailyOutputTonnes: 300, lastConnectionBranchId: 'B-W3' },
  ]);

  // ---- Sensors (on their branches, levels assigned) ----
  const calibrationDate = new Date('2026-09-01');
  const sensors = [
    { sensorId: 'S1', name: 'Intake Air Station', locationType: 'INTAKE',
      parameters: ['airflow', 'velocity', 'pressure', 'temp', 'wetBulb', 'humidity'],
      mapPosition: { x: 270, y: 120 }, branchId: 'B-INTAKE', districtId: 'D1', level: 'L-1',
      signalDbm: -58, batteryPct: 96, firmware: 'v2.4.1' },
    { sensorId: 'S2', name: 'District Intake Monitor', locationType: 'INTAKE',
      parameters: ['airflow', 'velocity', 'pressure'],
      mapPosition: { x: 440, y: 240 }, branchId: 'B-D1FEED', districtId: 'D1', level: 'L-2',
      signalDbm: -62, batteryPct: 91, firmware: 'v2.4.1' },
    { sensorId: 'S3', name: 'Last Ventilation Connection', locationType: 'LAST_VENTILATION_CONNECTION',
      parameters: ['airflow', 'velocity', 'temp', 'wetBulb', 'humidity'],
      mapPosition: { x: 500, y: 205 }, branchId: 'B-W1', districtId: 'D1', level: 'L-2',
      signalDbm: -66, batteryPct: 88, firmware: 'v2.3.7' },
    { sensorId: 'S4', name: 'District Return Gas Monitor', locationType: 'DISTRICT_RETURN_GENERAL_BODY',
      parameters: ['ch4', 'co2', 'co', 'o2', 'velocity', 'temp', 'wetBulb', 'humidity'],
      mapPosition: { x: 640, y: 420 }, branchId: 'B-RETRAISE', districtId: 'D2', level: 'L-4',
      signalDbm: -61, batteryPct: 93, firmware: 'v2.4.1' },
    { sensorId: 'S5', name: 'Working Place Climate Monitor', locationType: 'WORKING_PLACE',
      parameters: ['ch4', 'co2', 'co', 'o2', 'temp', 'wetBulb', 'humidity', 'dust'],
      mapPosition: { x: 500, y: 325 }, branchId: 'B-W3', districtId: 'D2', level: 'L-3',
      signalDbm: -69, batteryPct: 84, firmware: 'v2.4.1' },
    { sensorId: 'S6', name: 'Main Return Gas Monitor', locationType: 'MAIN_RETURN',
      parameters: ['ch4', 'co2', 'o2', 'pressure', 'airflow', 'velocity'],
      mapPosition: { x: 730, y: 480 }, branchId: 'B-FANDRIFT', districtId: 'D2', level: 'L-4',
      signalDbm: -64, batteryPct: 90, firmware: 'v2.3.7' },
    { sensorId: 'S7', name: 'Fan Drift Pressure Station', locationType: 'FAN_DRIFT',
      parameters: ['pressure', 'airflow', 'velocity', 'fanRpm'],
      mapPosition: { x: 790, y: 480 }, branchId: 'B-FANDRIFT', districtId: 'D2', level: 'L-4',
      signalDbm: -55, batteryPct: 98, firmware: 'v2.4.1' },
    { sensorId: 'S8', name: 'Fan House Monitor', locationType: 'FAN_HOUSE',
      parameters: ['fanRpm', 'temp', 'pressure'],
      mapPosition: { x: 820, y: 480 }, branchId: null, districtId: 'D2', level: 'L-4',
      signalDbm: -52, batteryPct: 100, firmware: 'v2.4.1' },
  ];
  for (const s of sensors) {
    await Sensor.create({
      ...s,
      type: 'virtual',
      status: 'ONLINE',
      lastSeenAt: new Date(), // fresh so the comms sweeper doesn't flap on seed
      expectedIntervalSec: 3,
      safetyCritical: true,
      calibrationDate,
      origin: 'simulated',
    });
  }

  // ---- Threshold profiles (all enabled, version 1) ----
  const profiles = [
    { profileKey: 'TP-O2-GENERAL', parameter: 'o2', locationType: 'ANY_PLACE',
      comparator: 'MIN', warning: 19.5, critical: 19, unit: '%vol', ruleType: 'limit',
      sourceType: 'STATUTORY', warningSourceType: 'DEMO', sourceRef: 'CMR 2017 Reg. 153(2)(b)' },
    { profileKey: 'TP-CO2-GENERAL', parameter: 'co2', locationType: 'ANY_PLACE',
      comparator: 'MAX', warning: 0.4, critical: 0.5, unit: '%vol', ruleType: 'limit',
      sourceType: 'STATUTORY', warningSourceType: 'DEMO', sourceRef: 'CMR 2017 Reg. 153(2)(b)' },
    { profileKey: 'TP-CH4-DRET', parameter: 'ch4', locationType: 'DISTRICT_RETURN_GENERAL_BODY',
      comparator: 'MAX', warning: 0.6, critical: 0.75, unit: '%vol', ruleType: 'limit',
      sourceType: 'STATUTORY', warningSourceType: 'DEMO', sourceRef: 'CMR 2017 Reg. 153(2)(c)' },
    { profileKey: 'TP-CH4-ANY', parameter: 'ch4', locationType: 'ANY_PLACE',
      comparator: 'MAX', warning: 1.0, critical: 1.25, unit: '%vol', ruleType: 'limit',
      sourceType: 'STATUTORY', warningSourceType: 'DEMO', sourceRef: 'CMR 2017 Reg. 153(2)(c)' },
    { profileKey: 'TP-WB-GENERAL', parameter: 'wetBulb', locationType: 'WORKING_PLACE',
      comparator: 'MAX', warning: 31.0, critical: 33.5, unit: '°C', ruleType: 'limit',
      sourceType: 'STATUTORY', warningSourceType: 'DEMO', sourceRef: 'CMR 2017 Reg. 153(2)(d)' },
    { profileKey: 'TP-WB-VELOCITY', parameter: 'wetBulb', locationType: 'WORKING_PLACE',
      comparator: 'MAX', warning: null, critical: null, unit: '°C', ruleType: 'compound',
      condition: { triggerAbove: 30.5, requiresParam: 'velocity', min: 1.0, unit: 'm/s' },
      sourceType: 'STATUTORY',
      sourceRef: 'CMR 2017 Reg. 153(2)(d) — above 30.5°C air shall move at not less than 1 m/s' },
    // Air-quantity factors live ON this profile — never hard-coded in the engine.
    { profileKey: 'TP-AIRQTY-FACTORS', parameter: 'requiredAir', locationType: 'LAST_VENTILATION_CONNECTION',
      comparator: 'MIN', warning: null, critical: null, unit: 'm³/min', ruleType: 'limit',
      factors: { perPerson: 6, perTonne: 2.5 },
      sourceType: 'STATUTORY', sourceRef: 'CMR 2017 Reg. 153(2)(a)' },
  ];
  for (const p of profiles) {
    await ThresholdProfile.create({
      ...p,
      version: 1,
      enabled: true,
      sourceDate: SOURCE_DATE,
      verificationNote: VERIFY_NOTE,
    });
  }

  // ---- Fans ----
  const fans = [
    { fanId: 'FAN-MAIN', name: 'Main Exhaust Fan', kind: 'main', branchId: 'B-FANDRIFT', level: 'L-4',
      status: 'RUNNING', rpm: 1450, ratedRpm: 1450, ratedPressurePa: 1800, ratedAirflowM3min: 2400,
      powerKw: 250, efficiencyPct: 76, fault: null, runtimeHours: 1240.5, auto: true },
    { fanId: 'FAN-AUX-1', name: 'District 1 Booster Fan', kind: 'aux', branchId: 'B-W2', level: 'L-2',
      status: 'RUNNING', rpm: 960, ratedRpm: 960, ratedPressurePa: 600, ratedAirflowM3min: 720,
      powerKw: 45, efficiencyPct: 72, fault: null, runtimeHours: 860.0, auto: true },
    { fanId: 'FAN-AUX-2', name: 'District 2 Booster Fan', kind: 'aux', branchId: 'B-W4', level: 'L-3',
      status: 'RUNNING', rpm: 960, ratedRpm: 960, ratedPressurePa: 600, ratedAirflowM3min: 720,
      powerKw: 45, efficiencyPct: 72, fault: null, runtimeHours: 912.25, auto: true },
  ];
  for (const f of fans) await Fan.create(f);

  // ---- Ventilation doors (one per working branch) ----
  const doors = [
    { doorId: 'D-01', name: 'Ventilation Door 1', branchId: 'B-W1', level: 'L-2', status: 'OPEN', positionPct: 100 },
    { doorId: 'D-02', name: 'Ventilation Door 2', branchId: 'B-W2', level: 'L-2', status: 'OPEN', positionPct: 100 },
    { doorId: 'D-03', name: 'Ventilation Door 3', branchId: 'B-W3', level: 'L-3', status: 'OPEN', positionPct: 100 },
    { doorId: 'D-04', name: 'Ventilation Door 4', branchId: 'B-W4', level: 'L-3', status: 'OPEN', positionPct: 100 },
  ];
  for (const d of doors) await VentilationDoor.create(d);

  // ---- Regulators (one per working branch) ----
  const regulators = [
    { regulatorId: 'R-01', name: 'Regulator 1', branchId: 'B-W1', level: 'L-2', openingPct: 70 },
    { regulatorId: 'R-02', name: 'Regulator 2', branchId: 'B-W2', level: 'L-2', openingPct: 70 },
    { regulatorId: 'R-03', name: 'Regulator 3', branchId: 'B-W3', level: 'L-3', openingPct: 70 },
    { regulatorId: 'R-04', name: 'Regulator 4', branchId: 'B-W4', level: 'L-3', openingPct: 70 },
  ];
  for (const r of regulators) await Regulator.create(r);

  // ---- Settings singleton ----
  await Setting.create({ key: 'mine' });

  const counts = {
    users: await User.countDocuments(),
    sensors: await Sensor.countDocuments(),
    branches: await Branch.countDocuments(),
    districts: await District.countDocuments(),
    thresholdProfiles: await ThresholdProfile.countDocuments(),
    fans: await Fan.countDocuments(),
    doors: await VentilationDoor.countDocuments(),
    regulators: await Regulator.countDocuments(),
  };
  // eslint-disable-next-line no-console
  console.log('[seed] done:', JSON.stringify(counts));
  await mongoose.disconnect();
}

seed().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', e.message || e);
  process.exit(1);
});

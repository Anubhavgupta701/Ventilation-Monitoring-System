const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { audit } = require('../lib/audit');
const realtime = require('../realtime');
const simulator = require('../simulator');

const router = express.Router();

// GET /simulator/status — any authenticated user
router.get('/status', authenticate, async (req, res, next) => {
  try {
    res.json(await simulator.getStatus());
  } catch (e) {
    next(e);
  }
});

// POST /simulator/pause — operator+
router.post('/pause', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const before = await simulator.getStatus();
    const result = simulator.pause();
    await audit(req, 'simulator.pause', 'simulator', 'transport', { paused: before.paused }, result);
    realtime.emit('simulator:transport', { paused: true, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /simulator/resume — operator+
router.post('/resume', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const before = await simulator.getStatus();
    const result = simulator.resume();
    await audit(req, 'simulator.resume', 'simulator', 'transport', { paused: before.paused }, result);
    realtime.emit('simulator:transport', { paused: false, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /simulator/reset — operator+
router.post('/reset', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const before = await simulator.getStatus();
    const result = await simulator.reset();
    await audit(req, 'simulator.reset', 'simulator', 'transport',
      { simTime: before.simTime, activeFaults: before.activeFaults }, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /simulator/speed { speed } — operator+
router.post('/speed', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { speed } = req.body || {};
    if (speed == null) throw httpError(400, 'VALIDATION_ERROR', 'Body must be { speed }');
    const before = await simulator.getStatus();
    const result = simulator.setSpeed(speed);
    await audit(req, 'simulator.speed', 'simulator', 'transport', { speed: before.speed }, result);
    realtime.emit('simulator:transport', { speed: result.speed, ts: new Date().toISOString() });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /simulator/faults — fault catalog, any authenticated user
router.get('/faults', authenticate, (req, res) => {
  res.json({ data: simulator.FAULT_CATALOG, total: simulator.FAULT_CATALOG.length });
});

// POST /simulator/faults { faultId, targetId? } — officer+: inject a fault
router.post('/faults', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const { faultId, targetId } = req.body || {};
    if (!faultId) throw httpError(400, 'VALIDATION_ERROR', 'faultId is required');
    const result = await simulator.injectFault(faultId, targetId);
    await audit(req, 'fault.inject', 'fault', `${faultId}${result.targetId ? `:${result.targetId}` : ''}`,
      null, result);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

// POST /simulator/faults/recover-all — officer+ (must be before /:faultId)
router.post('/faults/recover-all', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const before = await simulator.getStatus();
    const recovered = await simulator.recoverAllFaults();
    await audit(req, 'fault.recover-all', 'fault', 'all', { activeFaults: before.activeFaults }, { recovered });
    res.json({ recovered });
  } catch (e) {
    next(e);
  }
});

// POST /simulator/faults/:faultId/recover — officer+
router.post('/faults/:faultId/recover', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const targetId = (req.body && req.body.targetId) || req.query.targetId || null;
    const recovered = await simulator.recoverFault(req.params.faultId, targetId);
    await audit(req, 'fault.recover', 'fault', req.params.faultId, { targetId }, { recovered });
    res.json({ recovered });
  } catch (e) {
    next(e);
  }
});

// GET /simulator/scenarios — saved scenario catalog, any authenticated user
router.get('/scenarios', authenticate, (req, res) => {
  res.json({ data: simulator.SCENARIO_CATALOG, total: simulator.SCENARIO_CATALOG.length });
});

// POST /simulator/scenarios/:id/run — officer+: apply a saved scenario
router.post('/scenarios/:id/run', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const result = await simulator.runScenario(req.params.id);
    await audit(req, 'scenario.run', 'scenario', req.params.id, null, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /simulator/snapshots?from=&to=&limit= — any authenticated user
router.get('/snapshots', authenticate, async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
    const data = await simulator.getSnapshots(req.query.from, req.query.to, limit);
    res.json({ data, total: data.length });
  } catch (e) {
    next(e);
  }
});

// GET /simulator/snapshot?at=ISO — nearest snapshot at or before `at`
router.get('/snapshot', authenticate, async (req, res, next) => {
  try {
    const { at } = req.query;
    if (!at) throw httpError(400, 'VALIDATION_ERROR', '"at" ISO timestamp is required');
    const snap = await simulator.getSnapshotAt(at);
    if (!snap) throw httpError(404, 'NOT_FOUND', 'No snapshot at or before the given time');
    res.json(snap);
  } catch (e) {
    next(e);
  }
});

// POST /simulator/scenarios — officer+ (LEGACY v1 API, kept working)
// Runs the scenario ~5 min, then auto-reverts to normal.
router.post('/scenarios', authenticate, requireRole('officer'), async (req, res, next) => {
  try {
    const { scenario, targetSensorId } = req.body || {};
    if (!scenario) {
      throw httpError(400, 'VALIDATION_ERROR',
        `scenario is required (one of ${simulator.SCENARIOS.join(' | ')})`);
    }
    const result = await simulator.setScenario(scenario, targetSensorId);
    await audit(req, 'scenario.legacy-run', 'scenario', scenario,
      null, { ...result, targetSensorId });
    res.json({ ...result, startedAt: result.startedAt ? result.startedAt.toISOString() : null });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

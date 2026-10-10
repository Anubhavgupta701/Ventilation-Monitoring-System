// Stale sweeper — runs every ~2 s.
// STALE after 3 × expectedIntervalSec (9 s), OFFLINE after 10 × (30 s).
// Startup grace: the first sweep is skipped. On transition it raises a
// STALE_COMMS alert; overview overallStatus = DEGRADED whenever any
// safetyCritical sensor is STALE/OFFLINE.
const { Sensor } = require('./models/Sensor');
const alertService = require('./services/alertService');
const realtime = require('./realtime');

const SWEEP_MS = 2000;
const STALE_AFTER_MULT = 3;
const OFFLINE_AFTER_MULT = 10;

let lastOverall = null;

async function computeOverallStatus() {
  const bad = await Sensor.countDocuments({
    safetyCritical: true,
    status: { $in: ['STALE', 'OFFLINE'] },
  });
  return bad > 0 ? 'DEGRADED' : 'NORMAL';
}

async function sweep(grace) {
  const now = new Date();
  const sensors = await Sensor.find({}).lean();
  let changed = false;

  for (const sensor of sensors) {
    // Deliberately darkened by an active fault-injection: the fault owns this
    // sensor's status (and its comms alerts). The sweeper must not "heal" it
    // back ONLINE while the fault is active, nor raise duplicate alerts.
    // Lazy require avoids the simulator↔sweeper circular dependency.
    if (require('./simulator').isCommsDown(sensor.sensorId)) continue;

    const intervalSec = sensor.expectedIntervalSec || 3;
    const lastSeen = sensor.lastSeenAt ? new Date(sensor.lastSeenAt).getTime() : 0;
    const ageSec = lastSeen ? (now.getTime() - lastSeen) / 1000 : Infinity;

    let next = 'ONLINE';
    if (ageSec > OFFLINE_AFTER_MULT * intervalSec) next = 'OFFLINE';
    else if (ageSec > STALE_AFTER_MULT * intervalSec) next = 'STALE';

    if (next !== sensor.status) {
      if (grace) continue; // startup grace: don't flap on boot
      await Sensor.updateOne({ sensorId: sensor.sensorId }, { $set: { status: next } });
      changed = true;
      realtime.emit('sensor:status', {
        sensorId: sensor.sensorId,
        status: next,
        ts: now.toISOString(),
      });
      if (next === 'STALE' || next === 'OFFLINE') {
        await alertService.raiseCommsAlert(sensor, next);
      } else if (next === 'ONLINE') {
        // Recovery observed by the sweeper (the simulator tick has the same
        // fast path; resolveCommsAlerts is idempotent so both are safe).
        await alertService.resolveCommsAlerts(sensor);
      }
    }
  }

  const overall = await computeOverallStatus();
  if (changed || overall !== lastOverall) {
    lastOverall = overall;
    realtime.emit('system:status', { overallStatus: overall, serverTime: now.toISOString() });
  }
}

let timer = null;
function start() {
  if (timer) return;
  let first = true;
  timer = setInterval(() => {
    sweep(first).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[sweeper] sweep failed:', e.message);
    });
    first = false;
  }, SWEEP_MS);
  if (timer.unref) timer.unref();
}

module.exports = { start, sweep, computeOverallStatus };

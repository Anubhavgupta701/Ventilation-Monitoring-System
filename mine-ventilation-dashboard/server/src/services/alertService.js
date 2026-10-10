// Alert lifecycle: ACTIVE → ACKNOWLEDGED → RESOLVED.
// - Dedup via the partial unique index {sensorId, parameter, type} on open alerts.
// - WARNING → CRITICAL escalation resets status to ACTIVE + history entry.
// - Auto-resolve after 3 consecutive normal readings with 5% deadband.
// - Stale sensors never resolve gas alerts (no readings = no normal count).
const { Alert } = require('../models/Alert');
const { District } = require('../models/District');
const { ThresholdProfile } = require('../models/ThresholdProfile');
const { evaluateBreaches, selectEnabledProfiles, isClear } = require('../rules/engine');
const realtime = require('../realtime');

const RESOLVE_STREAK = 3;
const normalStreaks = new Map(); // alertId → consecutive normal reading count

async function loadContext(sensor) {
  const profiles = selectEnabledProfiles(
    await ThresholdProfile.find({ enabled: true }).lean()
  );
  let district = null;
  if (sensor.locationType === 'LAST_VENTILATION_CONNECTION' && sensor.districtId) {
    district = await District.findOne({ districtId: sensor.districtId }).lean();
  }
  return { profiles, district };
}

function hist(action, by, note) {
  return { ts: new Date(), action, by: by || 'system', note: note || '' };
}

async function saveAlert(alert) {
  try {
    await alert.save();
  } catch (e) {
    if (e.code === 11000) {
      // Lost a dedup race: refetch the open alert and merge.
      return Alert.findOne({
        sensorId: alert.sensorId,
        parameter: alert.parameter,
        type: alert.type,
        status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
      });
    }
    throw e;
  }
  return alert;
}

// Process one fresh reading: raise/update alerts for breaches and
// auto-resolve alerts whose parameters have been normal 3 readings in a row.
async function processReading(reading, sensor) {
  const values = reading.values || {};
  const { profiles, district } = await loadContext(sensor);
  const breaches = evaluateBreaches({ reading, sensor, profiles, district });

  const open = await Alert.find({
    sensorId: sensor.sensorId,
    status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
  });

  // 1) Breaches → create or update.
  for (const b of breaches) {
    let alert = open.find((a) => a.parameter === b.parameter && a.type === b.type);
    const now = reading.measuredAt || new Date();
    if (!alert) {
      alert = new Alert({
        sensorId: sensor.sensorId,
        parameter: b.parameter,
        type: b.type,
        origin: 'simulated',
        severity: b.severity,
        status: 'ACTIVE',
        openedAt: now,
        lastSeenAt: now,
        triggerValue: b.value,
        peakValue: b.value,
        thresholdSnapshot: b.thresholdSnapshot,
        history: [hist('opened', 'system', `${b.severity} ${b.type} breach: ${b.parameter}=${b.value}`)],
      });
      alert = await saveAlert(alert);
      realtime.emit('alert:created', alert.toObject());
    } else {
      alert.lastSeenAt = now;
      const comp = (alert.thresholdSnapshot || {}).comparator || 'MAX';
      if (comp === 'MIN') {
        if (b.value < (alert.peakValue ?? Infinity)) alert.peakValue = b.value;
      } else if (b.value > (alert.peakValue ?? -Infinity)) {
        alert.peakValue = b.value;
      }
      alert.thresholdSnapshot = b.thresholdSnapshot;
      let escalated = false;
      if (alert.severity === 'WARNING' && b.severity === 'CRITICAL') {
        alert.severity = 'CRITICAL';
        alert.status = 'ACTIVE';
        alert.acknowledgedBy = null;
        alert.acknowledgedAt = null;
        alert.ackNote = '';
        alert.history.push(hist('escalated', 'system', 'WARNING → CRITICAL; acknowledgement reset'));
        escalated = true;
      }
      await alert.save();
      realtime.emit('alert:updated', alert.toObject());
      if (escalated) normalStreaks.delete(String(alert._id));
    }
    normalStreaks.delete(String(alert._id));
  }

  // 2) Auto-resolve alerts that are no longer breaching.
  if (sensor.status === 'ONLINE' && reading.quality !== 'DROPOUT') {
    for (const alert of open) {
      if (alert.type === 'STALE_COMMS') continue; // resolved by the sweeper on recovery
      const stillBreached = breaches.some(
        (b) => b.parameter === alert.parameter && b.type === alert.type
      );
      if (stillBreached) continue;
      const id = String(alert._id);
      const clear = isClear({
        alert,
        values,
        profiles,
        district,
        profileKey: (alert.thresholdSnapshot || {}).profileKey,
      });
      if (clear) {
        const streak = (normalStreaks.get(id) || 0) + 1;
        normalStreaks.set(id, streak);
        if (streak >= RESOLVE_STREAK) {
          alert.status = 'RESOLVED';
          alert.resolvedAt = new Date();
          alert.resolution = 'auto-resolved';
          alert.history.push(
            hist('resolved', 'system', `${RESOLVE_STREAK} consecutive normal readings (5% deadband)`)
          );
          await alert.save();
          normalStreaks.delete(id);
          realtime.emit('alert:resolved', alert.toObject());
        }
      } else {
        normalStreaks.set(id, 0);
      }
    }
  }
}

// Raise a sensor-comms alert on STALE/OFFLINE transition (sweeper).
async function raiseCommsAlert(sensor, status) {
  const now = new Date();
  let alert = await Alert.findOne({
    sensorId: sensor.sensorId,
    parameter: 'comms',
    type: 'STALE_COMMS',
    status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
  });
  if (!alert) {
    alert = new Alert({
      sensorId: sensor.sensorId,
      parameter: 'comms',
      type: 'STALE_COMMS',
      origin: 'simulated',
      severity: 'WARNING',
      status: 'ACTIVE',
      openedAt: now,
      lastSeenAt: now,
      triggerValue: null,
      peakValue: null,
      thresholdSnapshot: {},
      history: [hist('opened', 'system', `Sensor ${status}: no reading within expected interval`)],
    });
    await saveAlert(alert);
    realtime.emit('alert:created', alert.toObject());
  } else {
    alert.lastSeenAt = now;
    await alert.save();
    realtime.emit('alert:updated', alert.toObject());
  }
}

// Resolve comms alerts when the sensor recovers.
async function resolveCommsAlerts(sensor) {
  const open = await Alert.find({
    sensorId: sensor.sensorId,
    parameter: 'comms',
    type: 'STALE_COMMS',
    status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
  });
  for (const alert of open) {
    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date();
    alert.resolution = 'comms-restored';
    alert.history.push(hist('resolved', 'system', 'Sensor back ONLINE'));
    await alert.save();
    realtime.emit('alert:resolved', alert.toObject());
  }
}

module.exports = { processReading, raiseCommsAlert, resolveCommsAlerts };

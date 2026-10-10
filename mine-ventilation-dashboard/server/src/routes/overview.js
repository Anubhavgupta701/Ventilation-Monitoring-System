const express = require('express');
const { authenticate } = require('../middleware/auth');
const { Sensor } = require('../models/Sensor');
const { Alert } = require('../models/Alert');
const { computeOverallStatus } = require('../sweeper');
const { UNITS } = require('../lib/units');

const router = express.Router();
const simulator = require('../simulator');

function ageSecOf(sensor, now) {
  if (!sensor.lastSeenAt) return null;
  return Math.max(0, Math.round((now - new Date(sensor.lastSeenAt).getTime()) / 1000));
}

// GET /overview — any authenticated user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const now = Date.now();
    const [sensors, openAlerts, overallStatus] = await Promise.all([
      Sensor.find({}).sort({ sensorId: 1 }).lean(),
      Alert.find({ status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } })
        .sort({ openedAt: -1 })
        .lean(),
      computeOverallStatus(),
    ]);

    const sevFor = (sensorId, param) => {
      const rel = openAlerts.filter(
        (a) => a.sensorId === sensorId && (param == null || a.parameter === param)
      );
      if (rel.some((a) => a.severity === 'CRITICAL')) return 'CRITICAL';
      if (rel.some((a) => a.severity === 'WARNING')) return 'WARNING';
      return null;
    };

    const withParam = (param) =>
      sensors.filter(
        (s) => s.lastReading && typeof s.lastReading[param] === 'number'
      );

    const extreme = (param, pick /* 'max' | 'min' */) => {
      const rows = withParam(param);
      if (!rows.length) return null;
      let best = rows[0];
      for (const s of rows) {
        if (pick === 'max' ? s.lastReading[param] > best.lastReading[param]
                           : s.lastReading[param] < best.lastReading[param]) best = s;
      }
      return {
        value: best.lastReading[param],
        sensorId: best.sensorId,
        location: best.name,
        ageSec: ageSecOf(best, now),
        severity: sevFor(best.sensorId, param),
      };
    };

    const kpis = [];
    const pushKpi = (label, unit, ext) => {
      kpis.push({
        label,
        value: ext ? ext.value : null,
        unit,
        location: ext ? ext.location : null,
        ageSec: ext ? ext.ageSec : null,
        severity: ext ? ext.severity : null,
      });
    };

    pushKpi('Max CH₄', UNITS.ch4, extreme('ch4', 'max'));
    pushKpi('Min O₂', UNITS.o2, extreme('o2', 'min'));
    pushKpi('Max CO₂', UNITS.co2, extreme('co2', 'max'));
    pushKpi('Max CO', UNITS.co, extreme('co', 'max'));
    pushKpi('Max wet-bulb', UNITS.wetBulb, extreme('wetBulb', 'max'));
    pushKpi('Max dust', UNITS.dust, extreme('dust', 'max'));

    // Total airflow across all flow stations.
    {
      const rows = withParam('airflow');
      const total = rows.reduce((sum, s) => sum + s.lastReading.airflow, 0);
      const maxAge = rows.length ? Math.max(...rows.map((s) => ageSecOf(s, now) || 0)) : null;
      let severity = null;
      for (const s of rows) {
        const sv = sevFor(s.sensorId, 'airflow');
        if (sv === 'CRITICAL') { severity = 'CRITICAL'; break; }
        if (sv === 'WARNING') severity = 'WARNING';
      }
      kpis.push({
        label: 'Total airflow',
        value: rows.length ? Math.round(total * 10) / 10 : null,
        unit: UNITS.airflow,
        location: rows.length ? 'All stations' : null,
        ageSec: maxAge,
        severity,
      });
    }

    pushKpi('Min velocity', UNITS.velocity, extreme('velocity', 'min'));

    // Fan pressure (S7) and fan RPM (S8).
    {
      const s7 = sensors.find((s) => s.sensorId === 'S7');
      const v = s7 && s7.lastReading && typeof s7.lastReading.pressure === 'number'
        ? s7.lastReading.pressure : null;
      kpis.push({
        label: 'Fan pressure', value: v, unit: UNITS.pressure,
        location: v == null ? null : 'Fan Drift',
        ageSec: s7 ? ageSecOf(s7, now) : null,
        severity: s7 ? sevFor('S7', 'pressure') : null,
      });
      const s8 = sensors.find((s) => s.sensorId === 'S8');
      const rpm = s8 && s8.lastReading && typeof s8.lastReading.fanRpm === 'number'
        ? s8.lastReading.fanRpm : null;
      kpis.push({
        label: 'Fan RPM', value: rpm, unit: UNITS.fanRpm,
        location: rpm == null ? null : 'Fan House',
        ageSec: s8 ? ageSecOf(s8, now) : null,
        severity: s8 ? sevFor('S8', 'fanRpm') : null,
      });
    }

    const alertSummary = {
      active: openAlerts.filter((a) => a.status === 'ACTIVE').length,
      acknowledged: openAlerts.filter((a) => a.status === 'ACKNOWLEDGED').length,
      critical: openAlerts.filter((a) => a.severity === 'CRITICAL').length,
      warning: openAlerts.filter((a) => a.severity === 'WARNING').length,
    };

    // v2: live simulator KPIs (one object, from the network solve).
    const liveBranches = simulator.getLiveBranches() || {};
    const envs = Object.values(liveBranches);
    const maxOf = (f) => (envs.length ? Math.max(...envs.map(f)) : null);
    const minOf = (f) => (envs.length ? Math.min(...envs.map(f)) : null);
    const simStatus = await simulator.getStatus().catch(() => null);
    const minV = minOf((e) => e.v);
    const minP = minOf((e) => e.pressurePa);
    const fanDrift = liveBranches['B-FANDRIFT'];

    res.json({
      serverTime: new Date(now).toISOString(),
      overallStatus,
      simulatedMode: true,
      sensors: sensors.map((s) => ({
        sensorId: s.sensorId,
        name: s.name,
        locationType: s.locationType,
        status: s.status,
        lastReading: s.lastReading,
        lastSeenAt: s.lastSeenAt,
      })),
      activeAlerts: openAlerts,
      alertSummary,
      kpis,
      // v2 extensions
      live: {
        airQuantityM3min: fanDrift ? Math.round(fanDrift.qMin * 10) / 10 : null,
        velocityMs: minV == null ? null : Math.round(minV * 1000) / 1000,
        ch4Pct: maxOf((e) => e.ch4),
        co2Pct: maxOf((e) => e.co2),
        coPpm: maxOf((e) => e.co),
        o2Pct: minOf((e) => e.o2),
        tempC: maxOf((e) => e.tempC),
        wetBulbC: maxOf((e) => e.wetBulbC),
        rhPct: maxOf((e) => e.rhPct),
        pressurePa: minP == null ? null : Math.round(minP),
      },
      simTime: simStatus ? simStatus.simTime : null,
      activeFaults: simStatus ? simStatus.activeFaults : [],
      requiredAirflow: simStatus ? simStatus.requiredAirflow : null,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

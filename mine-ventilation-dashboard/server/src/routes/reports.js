const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { buildCsv, SAFETY_NOTICE } = require('../lib/csv');
const { UNITS, PARAM_LABELS } = require('../lib/units');
const { Reading, VALUE_PARAMS } = require('../models/Reading');
const { Alert } = require('../models/Alert');
const { AuditLog } = require('../models/AuditLog');
const { Sensor } = require('../models/Sensor');
const { Branch } = require('../models/Branch');
const { Fan } = require('../models/Fan');
const { ThresholdProfile } = require('../models/ThresholdProfile');
const { getSettings } = require('../models/Setting');
const { buildPdf } = require('../lib/pdf');
const { calculateVentilation } = require('../calculations/ventilation');
const simulator = require('../simulator');

const router = express.Router();
const MAX_ROWS = 50000;

function csvResponse(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(text);
}

// GET /reports/readings.csv?sensorId=&from=&to= — operator+
router.get('/readings.csv', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { sensorId, from, to } = req.query;
    const filter = {};
    if (sensorId) filter.sensorId = sensorId;
    if (from || to) {
      filter.measuredAt = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
        filter.measuredAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
        filter.measuredAt.$lte = d;
      }
    }
    const readings = await Reading.find(filter)
      .sort({ measuredAt: 1 })
      .limit(MAX_ROWS)
      .lean();

    const rows = [];
    for (const r of readings) {
      const values = r.values || {};
      for (const param of VALUE_PARAMS) {
        if (values[param] == null) continue;
        rows.push([
          new Date(r.measuredAt).toISOString(),
          r.sensorId,
          param,
          PARAM_LABELS[param] || param,
          values[param],
          UNITS[param] || '',
          r.quality,
        ]);
      }
    }

    const csv = buildCsv({
      title: 'Mine Ventilation Monitoring — readings export',
      generatedAt: new Date().toISOString(),
      safetyNotice: SAFETY_NOTICE,
      columns: ['measuredAt_utc', 'sensorId', 'parameter', 'parameterLabel', 'value', 'unit', 'quality'],
      rows,
    });
    csvResponse(res, 'readings.csv', csv);
  } catch (e) {
    next(e);
  }
});

// GET /reports/alerts.csv?from=&to= — operator+
router.get('/alerts.csv', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.openedAt = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
        filter.openedAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
        filter.openedAt.$lte = d;
      }
    }
    const alerts = await Alert.find(filter).sort({ openedAt: -1 }).limit(MAX_ROWS).lean();

    const rows = alerts.map((a) => [
      new Date(a.openedAt).toISOString(),
      a.alertId,
      a.sensorId,
      a.parameter,
      a.type,
      a.severity,
      a.status,
      a.triggerValue,
      a.peakValue,
      a.acknowledgedBy || '',
      a.acknowledgedAt ? new Date(a.acknowledgedAt).toISOString() : '',
      a.resolvedAt ? new Date(a.resolvedAt).toISOString() : '',
      a.resolution || '',
    ]);

    const csv = buildCsv({
      title: 'Mine Ventilation Monitoring — alerts export',
      generatedAt: new Date().toISOString(),
      safetyNotice: SAFETY_NOTICE,
      columns: ['openedAt_utc', 'alertId', 'sensorId', 'parameter', 'type', 'severity', 'status',
        'triggerValue', 'peakValue', 'acknowledgedBy', 'acknowledgedAt_utc', 'resolvedAt_utc', 'resolution'],
      rows,
    });
    csvResponse(res, 'alerts.csv', csv);
  } catch (e) {
    next(e);
  }
});

const REPORT_TYPES = [
  'daily-ventilation', 'sensor', 'incident', 'airflow-survey',
  'gas-monitoring', 'fan-performance', 'compliance-calc',
];

function r3(v) {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

async function paramStats(sensorIds, from, to) {
  // { sensorId: { param: { avg, min, max, n } } }
  const out = {};
  for (const sensorId of sensorIds) {
    const group = { _id: null, n: { $sum: 1 } };
    for (const p of VALUE_PARAMS) {
      group[`${p}_avg`] = { $avg: `$values.${p}` };
      group[`${p}_min`] = { $min: `$values.${p}` };
      group[`${p}_max`] = { $max: `$values.${p}` };
    }
    const rows = await Reading.aggregate([
      { $match: { sensorId, measuredAt: { $gte: from, $lte: to } } },
      { $group: group },
    ]);
    const row = rows[0];
    out[sensorId] = {};
    if (row) {
      for (const p of VALUE_PARAMS) {
        if (row[`${p}_avg`] != null) {
          out[sensorId][p] = {
            avg: r3(row[`${p}_avg`]), min: r3(row[`${p}_min`]),
            max: r3(row[`${p}_max`]), n: row.n,
          };
        }
      }
    }
  }
  return out;
}

function periodOf(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  if (Number.isNaN(to.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "to" date');
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 24 * 3600 * 1000);
  if (Number.isNaN(from.getTime())) throw httpError(400, 'VALIDATION_ERROR', 'Invalid "from" date');
  if (from >= to) throw httpError(400, 'VALIDATION_ERROR', '"from" must be before "to"');
  return { from, to };
}

// Build one of the 7 typed reports. Returns { title, period, csv, pdfSections }.
async function buildReport(type, req) {
  const { from, to } = periodOf(req);
  const settings = await getSettings();
  const period = `${from.toISOString()} → ${to.toISOString()}`;
  const sensors = await Sensor.find({}).sort({ sensorId: 1 }).lean();
  const sensorIds = sensors.map((s) => s.sensorId);
  const alerts = await Alert.find({ openedAt: { $gte: from, $lte: to } })
    .sort({ openedAt: -1 }).limit(5000).lean();
  const auditEvents = await AuditLog.find({ ts: { $gte: from, $lte: to } })
    .sort({ ts: -1 }).limit(200).lean();

  const auditSection = {
    heading: 'Audit events',
    text: `${auditEvents.length} most recent control/settings/threshold actions in the period.`,
    columns: [
      { label: 'Time (UTC)', key: 'ts', width: 130 },
      { label: 'Actor', key: 'actor', width: 80 },
      { label: 'Action', key: 'action', width: 130 },
      { label: 'Entity', key: 'entity', width: 150 },
    ],
    rows: auditEvents.slice(0, 100).map((a) => ({
      ts: new Date(a.ts).toISOString(),
      actor: a.actor,
      action: a.action,
      entity: `${a.entityType}:${a.entityId}`,
    })),
  };

  let title, csvColumns, csvRows, pdfSections;

  if (type === 'daily-ventilation') {
    title = 'Daily ventilation report';
    const stats = await paramStats(sensorIds, from, to);
    csvColumns = ['sensorId', 'parameter', 'label', 'avg', 'min', 'max', 'samples', 'unit'];
    csvRows = [];
    for (const sid of sensorIds) {
      for (const [p, s] of Object.entries(stats[sid] || {})) {
        csvRows.push([sid, p, PARAM_LABELS[p] || p, s.avg, s.min, s.max, s.n, UNITS[p] || '']);
      }
    }
    pdfSections = [
      {
        heading: 'Reading summary',
        text: `Per-sensor, per-parameter avg/min/max over the period (${alerts.length} alerts opened).`,
        columns: [
          { label: 'Sensor', key: 'sensorId', width: 60 },
          { label: 'Parameter', key: 'param', width: 90 },
          { label: 'Avg', key: 'avg', width: 70 },
          { label: 'Min', key: 'min', width: 70 },
          { label: 'Max', key: 'max', width: 70 },
          { label: 'Unit', key: 'unit', width: 60 },
        ],
        rows: csvRows.map((r) => ({
          sensorId: r[0], param: r[2], avg: r[3], min: r[4], max: r[5], unit: r[7],
        })),
      },
      {
        heading: 'Alerts',
        text: `${alerts.length} alerts opened in the period.`,
        columns: [
          { label: 'Opened (UTC)', key: 'openedAt', width: 130 },
          { label: 'Sensor', key: 'sensorId', width: 60 },
          { label: 'Param', key: 'parameter', width: 70 },
          { label: 'Severity', key: 'severity', width: 70 },
          { label: 'Status', key: 'status', width: 90 },
        ],
        rows: alerts.slice(0, 100).map((a) => ({
          openedAt: new Date(a.openedAt).toISOString(), sensorId: a.sensorId,
          parameter: a.parameter, severity: a.severity, status: a.status,
        })),
      },
      auditSection,
    ];
  } else if (type === 'sensor') {
    const sensorId = req.query.sensorId;
    if (!sensorId) throw httpError(400, 'VALIDATION_ERROR', 'sensorId query param is required');
    const sensor = await Sensor.findOne({ sensorId }).lean();
    if (!sensor) throw httpError(404, 'NOT_FOUND', `Sensor ${sensorId} not found`);
    title = `Sensor report — ${sensorId}`;
    const stats = await paramStats([sensorId], from, to);
    const recent = await Reading.find({ sensorId, measuredAt: { $gte: from, $lte: to } })
      .sort({ measuredAt: -1 }).limit(50).lean();
    csvColumns = ['parameter', 'label', 'avg', 'min', 'max', 'samples', 'unit'];
    csvRows = Object.entries(stats[sensorId] || {}).map(([p, s]) =>
      [p, PARAM_LABELS[p] || p, s.avg, s.min, s.max, s.n, UNITS[p] || '']);
    pdfSections = [
      {
        heading: 'Sensor details',
        kv: [
          ['Sensor', `${sensor.sensorId} — ${sensor.name}`],
          ['Location', `${sensor.locationType} · ${sensor.level || ''} · branch ${sensor.branchId || '—'}`],
          ['Status', sensor.status],
          ['Parameters', (sensor.parameters || []).join(', ')],
          ['Firmware', `${sensor.firmware || ''} · signal ${sensor.signalDbm} dBm · battery ${sensor.batteryPct}%`],
        ],
      },
      {
        heading: 'Parameter statistics',
        columns: [
          { label: 'Parameter', key: 'param', width: 120 },
          { label: 'Avg', key: 'avg', width: 80 },
          { label: 'Min', key: 'min', width: 80 },
          { label: 'Max', key: 'max', width: 80 },
          { label: 'Unit', key: 'unit', width: 70 },
        ],
        rows: csvRows.map((r) => ({ param: r[1], avg: r[2], min: r[3], max: r[4], unit: r[6] })),
      },
      {
        heading: 'Recent readings (latest 50)',
        columns: [
          { label: 'Measured (UTC)', key: 't', width: 140 },
          { label: 'Values', key: 'values', width: 330 },
          { label: 'Quality', key: 'quality', width: 70 },
        ],
        rows: recent.map((r) => ({
          t: new Date(r.measuredAt).toISOString(),
          values: Object.entries(r.values || {}).map(([k, v]) => `${k}=${v}`).join(' '),
          quality: r.quality,
        })),
      },
      auditSection,
    ];
  } else if (type === 'incident') {
    title = 'Incident report';
    csvColumns = ['openedAt_utc', 'alertId', 'sensorId', 'parameter', 'type', 'severity', 'status',
      'triggerValue', 'peakValue', 'acknowledgedBy', 'resolvedAt_utc', 'resolution'];
    csvRows = alerts.map((a) => [
      new Date(a.openedAt).toISOString(), a.alertId, a.sensorId, a.parameter, a.type,
      a.severity, a.status, a.triggerValue, a.peakValue, a.acknowledgedBy || '',
      a.resolvedAt ? new Date(a.resolvedAt).toISOString() : '', a.resolution || '',
    ]);
    pdfSections = [
      {
        heading: 'Incidents',
        text: `${alerts.length} alerts opened in the period.`,
        columns: [
          { label: 'Opened (UTC)', key: 'openedAt', width: 125 },
          { label: 'Sensor', key: 'sensorId', width: 55 },
          { label: 'Param', key: 'parameter', width: 65 },
          { label: 'Severity', key: 'severity', width: 65 },
          { label: 'Status', key: 'status', width: 85 },
          { label: 'Trigger', key: 'triggerValue', width: 60 },
          { label: 'Peak', key: 'peakValue', width: 60 },
        ],
        rows: alerts.slice(0, 150).map((a) => ({
          openedAt: new Date(a.openedAt).toISOString().slice(0, 19).replace('T', ' '),
          sensorId: a.sensorId, parameter: a.parameter, severity: a.severity,
          status: a.status, triggerValue: a.triggerValue, peakValue: a.peakValue,
        })),
      },
      auditSection,
    ];
  } else if (type === 'airflow-survey') {
    title = 'Airflow survey report';
    const branches = await Branch.find({}).sort({ branchId: 1 }).lean();
    const live = simulator.getLiveBranches() || {};
    csvColumns = ['branchId', 'name', 'level', 'direction', 'area_m2', 'airflow_m3min', 'velocity_ms', 'pressureDrop_Pa', 'status'];
    csvRows = branches.map((b) => {
      const l = live[b.branchId];
      return [b.branchId, b.name, b.level, b.direction, b.area,
        l ? r3(l.qMin) : null, l ? r3(l.v) : null, l ? Math.round(l.dp) : null, l ? l.status : null];
    });
    const stats = await paramStats(sensorIds, from, to);
    pdfSections = [
      {
        heading: 'Branch airflows (live at generation)',
        columns: [
          { label: 'Branch', key: 'branchId', width: 80 },
          { label: 'Name', key: 'name', width: 150 },
          { label: 'Level', key: 'level', width: 45 },
          { label: 'Q (m³/min)', key: 'q', width: 70 },
          { label: 'v (m/s)', key: 'v', width: 60 },
          { label: 'ΔP (Pa)', key: 'dp', width: 60 },
          { label: 'Status', key: 'status', width: 70 },
        ],
        rows: csvRows.map((r) => ({
          branchId: r[0], name: r[1], level: r[2], q: r[5], v: r[6], dp: r[7], status: r[8],
        })),
      },
      {
        heading: 'Airflow station statistics (period)',
        columns: [
          { label: 'Sensor', key: 'sensorId', width: 60 },
          { label: 'Avg Q (m³/min)', key: 'avg', width: 90 },
          { label: 'Min', key: 'min', width: 80 },
          { label: 'Max', key: 'max', width: 80 },
          { label: 'Avg v (m/s)', key: 'v', width: 80 },
        ],
        rows: sensorIds
          .filter((sid) => stats[sid] && stats[sid].airflow)
          .map((sid) => ({
            sensorId: sid, avg: stats[sid].airflow.avg, min: stats[sid].airflow.min,
            max: stats[sid].airflow.max, v: stats[sid].velocity ? stats[sid].velocity.avg : null,
          })),
      },
      auditSection,
    ];
  } else if (type === 'gas-monitoring') {
    title = 'Gas monitoring report';
    const gasParams = ['ch4', 'co2', 'co', 'o2'];
    const stats = await paramStats(sensorIds, from, to);
    csvColumns = ['sensorId', 'parameter', 'avg', 'min', 'max', 'samples', 'unit'];
    csvRows = [];
    for (const sid of ['S4', 'S5', 'S6']) {
      for (const p of gasParams) {
        const s = (stats[sid] || {})[p];
        if (s) csvRows.push([sid, p, s.avg, s.min, s.max, s.n, UNITS[p] || '']);
      }
    }
    pdfSections = [
      {
        heading: 'Gas statistics (S4/S5/S6)',
        text: 'Statutory limits come from the enabled threshold profiles (CMR 2017 Reg. 153); see the thresholds page.',
        columns: [
          { label: 'Sensor', key: 'sensorId', width: 60 },
          { label: 'Parameter', key: 'param', width: 80 },
          { label: 'Avg', key: 'avg', width: 80 },
          { label: 'Min', key: 'min', width: 80 },
          { label: 'Max', key: 'max', width: 80 },
          { label: 'Unit', key: 'unit', width: 60 },
        ],
        rows: csvRows.map((r) => ({
          sensorId: r[0], param: PARAM_LABELS[r[1]] || r[1], avg: r[2], min: r[3], max: r[4], unit: r[6],
        })),
      },
      {
        heading: 'Gas alerts in period',
        columns: [
          { label: 'Opened (UTC)', key: 'openedAt', width: 130 },
          { label: 'Sensor', key: 'sensorId', width: 60 },
          { label: 'Param', key: 'parameter', width: 70 },
          { label: 'Severity', key: 'severity', width: 70 },
          { label: 'Peak', key: 'peakValue', width: 80 },
        ],
        rows: alerts
          .filter((a) => gasParams.includes(a.parameter))
          .slice(0, 100)
          .map((a) => ({
            openedAt: new Date(a.openedAt).toISOString(), sensorId: a.sensorId,
            parameter: a.parameter, severity: a.severity, peakValue: a.peakValue,
          })),
      },
      auditSection,
    ];
  } else if (type === 'fan-performance') {
    title = 'Fan performance report';
    const fans = await Fan.find({}).sort({ fanId: 1 }).lean();
    csvColumns = ['fanId', 'name', 'kind', 'status', 'rpm', 'ratedRpm', 'airflow_m3min',
      'pressure_Pa', 'efficiency_pct', 'power_kW', 'runtime_hours', 'auto'];
    csvRows = fans.map((f) => [f.fanId, f.name, f.kind, f.status, f.rpm, f.ratedRpm,
      r3(f.airflowM3min), Math.round(f.pressurePa), r3(f.efficiencyPct), f.powerKw,
      r3(f.runtimeHours), f.auto]);
    pdfSections = [
      {
        heading: 'Fans (live at generation)',
        columns: [
          { label: 'Fan', key: 'fanId', width: 80 },
          { label: 'Status', key: 'status', width: 75 },
          { label: 'RPM', key: 'rpm', width: 60 },
          { label: 'Q (m³/min)', key: 'q', width: 70 },
          { label: 'P (Pa)', key: 'p', width: 60 },
          { label: 'Eff %', key: 'eff', width: 55 },
          { label: 'Runtime h', key: 'rt', width: 70 },
        ],
        rows: csvRows.map((r) => ({
          fanId: r[0], status: r[3], rpm: r[4], q: r[6], p: r[7], eff: r[8], rt: r[10],
        })),
      },
      auditSection,
    ];
  } else if (type === 'compliance-calc') {
    title = 'Compliance calculation report';
    const profile = await ThresholdProfile.findOne({ profileKey: 'TP-AIRQTY-FACTORS', enabled: true })
      .sort({ version: -1 }).lean();
    if (!profile || !profile.factors) {
      throw httpError(409, 'CONFLICT', 'TP-AIRQTY-FACTORS profile not available');
    }
    const live = simulator.getLiveBranches() || {};
    const lvc = live['B-W1'];
    const s3 = await Sensor.findOne({ sensorId: 'S3' }).lean();
    const measuredAirflow = lvc ? r3(lvc.qMin)
      : (s3 && s3.lastReading ? s3.lastReading.airflow : null);
    const calc = calculateVentilation(
      {
        persons: settings.persons,
        dailyOutputTonnes: settings.dailyProductionTonnes,
        area: 8,
        measuredAirflow,
      },
      { perPerson: profile.factors.perPerson, perTonne: profile.factors.perTonne, sourceRef: profile.sourceRef }
    );
    csvColumns = ['step', 'expression', 'result'];
    csvRows = calc.steps.map((s) => [s.label, s.expr, s.result]);
    pdfSections = [
      {
        heading: 'Air-quantity compliance',
        text: `Factors from ${profile.profileKey} v${profile.version} (${profile.sourceRef}); persons and production from mine settings.`,
        kv: [
          ['Required air quantity', `${calc.results.qRequired} m³/min`],
          ['Measured airflow (B-W1, LVC)', measuredAirflow == null ? '—' : `${measuredAirflow} m³/min`],
          ['Compliance margin', calc.results.complianceMargin],
          ['Air quantity', calc.results.airQuantity],
          ['Overall', calc.results.overall],
        ],
      },
      {
        heading: 'Working steps',
        columns: [
          { label: 'Step', key: 'label', width: 170 },
          { label: 'Expression', key: 'expr', width: 220 },
          { label: 'Result', key: 'result', width: 110 },
        ],
        rows: calc.steps.map((s) => ({ label: s.label, expr: s.expr, result: s.result })),
      },
      auditSection,
    ];
  } else {
    throw httpError(404, 'NOT_FOUND', `Unknown report type "${type}" (one of ${REPORT_TYPES.join('|')})`);
  }

  return {
    title, period, mineName: settings.mineName,
    csvColumns, csvRows, pdfSections,
    generatedAt: new Date().toISOString(),
  };
}

function pdfResponse(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

// GET /reports/:type?format=csv|pdf&from=&to=&sensorId= — operator+
router.get('/:type', authenticate, requireRole('operator'), async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!REPORT_TYPES.includes(type)) {
      throw httpError(404, 'NOT_FOUND', `Unknown report type "${type}" (one of ${REPORT_TYPES.join('|')})`);
    }
    const format = (req.query.format || 'csv').toLowerCase();
    if (!['csv', 'pdf'].includes(format)) {
      throw httpError(400, 'VALIDATION_ERROR', 'format must be csv or pdf');
    }
    const report = await buildReport(type, req);
    if (format === 'pdf') {
      const buffer = await buildPdf({
        title: `Mine Ventilation Monitoring — ${report.title}`,
        mineName: report.mineName,
        generatedAt: report.generatedAt,
        period: report.period,
        sections: report.pdfSections,
      });
      pdfResponse(res, `${type}.pdf`, buffer);
      return;
    }
    const csv = buildCsv({
      title: `Mine Ventilation Monitoring — ${report.title} (${report.period})`,
      generatedAt: report.generatedAt,
      safetyNotice: SAFETY_NOTICE,
      columns: report.csvColumns,
      rows: report.csvRows,
    });
    csvResponse(res, `${type}.csv`, csv);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

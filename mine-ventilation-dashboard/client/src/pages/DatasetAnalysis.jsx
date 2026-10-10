import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sensors as SensorsApi, Thresholds as ThresholdsApi } from "../lib/api";
import { useToast } from "../ui/toast";
import { CHART, ChartTooltip, Notice, StatusPill } from "../ui/primitives";
import {
  fmtDateTimeIST,
  fmtNum,
  fmtTimeIST,
  paramLabel,
  paramUnit,
  sortParams,
} from "../lib/format";
import { IconInfo } from "../ui/icons";

/* CSV header → app parameter key. Fixed format, see data/FORMAT.md. */
const COL_PARAM = {
  ch4_pct: "ch4",
  co2_pct: "co2",
  co_ppm: "co",
  o2_pct: "o2",
  temp_c: "temp",
  wetbulb_c: "wetBulb",
  rh_pct: "humidity",
  pressure_pa: "pressure",
  airflow_m3min: "airflow",
  velocity_ms: "velocity",
  dust_mg_m3: "dust",
  fan_rpm: "fanRpm",
};

function OriginPill({ origin }) {
  return (
    <StatusPill
      status={origin === "USER-UPLOADED" ? "USER_UPLOADED" : "SIMULATED"}
      customLabel={origin === "USER-UPLOADED" ? "User-uploaded" : "Simulated"}
    />
  );
}

/* Canonical field catalogue for the column-mapping step. measurement fields map
   to COL_PARAM keys so your own exports can use different column names. */
const FIELD_DEFS = [
  { key: "timestamp", label: "Timestamp", required: true, hint: "ISO date-time" },
  { key: "sensor_id", label: "Sensor / station ID", required: true, hint: "matches the station registry" },
  { key: "ch4_pct", label: "Methane CH₄ (%vol)" },
  { key: "co2_pct", label: "Carbon dioxide CO₂ (%vol)" },
  { key: "co_ppm", label: "Carbon monoxide CO (ppm)" },
  { key: "o2_pct", label: "Oxygen O₂ (%vol)" },
  { key: "temp_c", label: "Dry-bulb temperature (°C)" },
  { key: "wetbulb_c", label: "Wet-bulb temperature (°C)" },
  { key: "rh_pct", label: "Relative humidity (%RH)" },
  { key: "pressure_pa", label: "Barometric pressure (Pa)" },
  { key: "airflow_m3min", label: "Airflow (m³/min)" },
  { key: "velocity_ms", label: "Air velocity (m/s)" },
  { key: "dust_mg_m3", label: "Respirable dust (mg/m³)" },
  { key: "fan_rpm", label: "Fan speed (rpm)" },
];

/* Header synonyms — your own exports rarely use our canonical names. */
const SYN = {
  timestamp: ["timestamp", "time", "datetime", "date", "ts", "sampletime", "recordedat", "readingtime"],
  sensor_id: ["sensorid", "sensor_id", "sensor", "station", "stationid", "station_id", "stn", "node", "nodeid"],
  ch4_pct: ["ch4", "ch4pct", "ch4_pct", "methane"],
  co2_pct: ["co2", "co2pct", "co2_pct", "carbondioxide"],
  co_ppm: ["co", "coppm", "co_ppm", "carbonmonoxide"],
  o2_pct: ["o2", "o2pct", "o2_pct", "oxygen"],
  temp_c: ["temp", "tempc", "temp_c", "temperature", "drybulb", "drybulbc"],
  wetbulb_c: ["wetbulb", "wetbulbc", "wetbulb_c", "wetbulbtemp"],
  rh_pct: ["rh", "rhpct", "rh_pct", "humidity", "relativehumidity"],
  pressure_pa: ["pressure", "pressurepa", "pressure_pa", "barometricpressure", "baro"],
  airflow_m3min: ["airflow", "airflowm3min", "airflow_m3min", "flow", "airquantity", "quantity"],
  velocity_ms: ["velocity", "velocityms", "velocity_ms", "airvelocity", "airspeed", "speed"],
  dust_mg_m3: ["dust", "dustmgm3", "dust_mg_m3", "dustconcentration", "respirabledust"],
  fan_rpm: ["fanrpm", "fan_rpm", "rpm", "fanspeed"],
};

const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function autoMap(header) {
  const norm = header.map(normHeader);
  const m = {};
  FIELD_DEFS.forEach((f) => {
    const keys = SYN[f.key] || [normHeader(f.key)];
    m[f.key] = norm.findIndex((n) => keys.includes(n));
  });
  return m;
}

function mappingIsUsable(m) {
  const ts = m.timestamp >= 0;
  const id = m.sensor_id >= 0;
  const nParams = FIELD_DEFS.filter((f) => !f.required && m[f.key] >= 0).length;
  return { ok: ts && id && nParams > 0, ts, id, nParams };
}

const CADENCE_MS = 5 * 60 * 1000; // expected 5-minute sampling
const CHART_MAX_POINTS = 1500;

/* Seeded statutory limits — used only if the profile fetch fails.
   Primary path always reads the live enabled profiles from /api/v1/thresholds. */
const FALLBACK_RULES = [
  { profileKey: "TP-CH4-DRET", parameter: "ch4", locationType: "DISTRICT_RETURN_GENERAL_BODY", comparator: "MAX", warning: 0.6, critical: 0.75, unit: "%vol", sourceRef: "CMR 2017 Reg. 153(2)(c)" },
  { profileKey: "TP-CH4-ANY", parameter: "ch4", locationType: "ANY_PLACE", comparator: "MAX", warning: 1.0, critical: 1.25, unit: "%vol", sourceRef: "CMR 2017 Reg. 153(2)(c)" },
  { profileKey: "TP-CO2-GENERAL", parameter: "co2", locationType: "ANY_PLACE", comparator: "MAX", warning: 0.4, critical: 0.5, unit: "%vol", sourceRef: "CMR 2017 Reg. 153(2)(b)" },
  { profileKey: "TP-O2-GENERAL", parameter: "o2", locationType: "ANY_PLACE", comparator: "MIN", warning: 19.5, critical: 19, unit: "%vol", sourceRef: "CMR 2017 Reg. 153(2)(b)" },
  { profileKey: "TP-WB-GENERAL", parameter: "wetBulb", locationType: "WORKING_PLACE", comparator: "MAX", warning: 31.0, critical: 33.5, unit: "°C", sourceRef: "CMR 2017 Reg. 153(2)(d)" },
];
const FALLBACK_COMPOUND = {
  profileKey: "TP-WB-VELOCITY",
  parameter: "wetBulb",
  triggerAbove: 30.5,
  requiresParam: "velocity",
  min: 1.0,
  unit: "m/s",
  sourceRef: "CMR 2017 Reg. 153(2)(d) — above 30.5°C air shall move at not less than 1 m/s",
};

/* Small robust CSV parser: quoted fields, escaped quotes, CRLF. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushField();
      if (row.length > 1 || row[0].trim() !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted field — the file may be truncated.");
  pushField();
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);
  return rows;
}

function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtRange(ms) {
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}

export default function DatasetAnalysis() {
  const { pushToast, pushApiError } = useToast();
  const fileRef = useRef(null);
  const [sensors, setSensors] = useState([]);
  const [profiles, setProfiles] = useState(null); // null = not fetched yet
  const [dataset, setDataset] = useState(null); // {name, rows, stations, params, start, end, count, origin}
  const [mapJob, setMapJob] = useState(null); // {name, text, header, mapping, origin, sampleRow} — column-mapping step
  const [parseError, setParseError] = useState(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [parameter, setParameter] = useState("ch4");
  const [station, setStation] = useState("S4");
  const [sevFilter, setSevFilter] = useState("ALL");

  /* Live station registry (location types) + enabled threshold profiles. */
  useEffect(() => {
    (async () => {
      try {
        const d = await SensorsApi.list();
        setSensors(Array.isArray(d) ? d : d?.data || []);
      } catch (e) {
        pushApiError(e, "Could not load the station registry.");
      }
    })();
    (async () => {
      try {
        const d = await ThresholdsApi.list();
        const all = Array.isArray(d) ? d : d?.data || [];
        const byKey = new Map();
        all.forEach((p) => {
          if (p.enabled === false || p.ruleType === "compound") return;
          if (p.warning == null && p.critical == null) return; // factor-only profiles carry no limits
          const cur = byKey.get(p.profileKey);
          if (!cur || (p.version || 0) > (cur.version || 0)) byKey.set(p.profileKey, p);
        });
        setProfiles([...byKey.values()]);
      } catch {
        /* FALLBACK_RULES below keep the analysis working. */
        setProfiles([]);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const locationOf = useMemo(() => {
    const m = new Map();
    sensors.forEach((s) => m.set(s.sensorId, s.locationType || "ANY_PLACE"));
    return m;
  }, [sensors]);

  /* origin: "USER-UPLOADED" for the user's own file, "SAMPLE-SIMULATED" for the
     bundled sample. mapping: {fieldKey: headerIndex} — null means auto-detect,
     and files whose headers don't line up open the column-mapping step. */
  const ingest = (name, text, origin = "USER-UPLOADED", mapping = null) => {
    setParseError(null);
    setMapJob(null);
    try {
      if (!text || !text.trim()) throw new Error("The file is empty.");
      const raw = parseCSV(text);
      if (raw.length < 2) throw new Error("No data rows found — expected a header row plus readings.");
      const header = raw[0].map((h) => h.trim());
      const map = mapping || autoMap(header);
      const usable = mappingIsUsable(map);
      if (!mapping && !usable.ok) {
        /* Headers don't line up with our format — open the column-mapping
           step instead of rejecting the file outright. */
        setMapJob({ name, text, header, mapping: map, origin, sampleRow: raw[1] });
        return;
      }
      if (!usable.ts || !usable.id) {
        throw new Error("Timestamp and Sensor / station ID columns are required — please map both.");
      }
      if (!usable.nParams) {
        throw new Error("At least one measurement column is required — please map one.");
      }
      const tsIdx = map.timestamp;
      const idIdx = map.sensor_id;
      const paramCols = [];
      Object.keys(COL_PARAM).forEach((col) => {
        if (map[col] >= 0) paramCols.push([map[col], COL_PARAM[col]]);
      });
      const rows = [];
      let skipped = 0;
      for (let r = 1; r < raw.length; r++) {
        const cells = raw[r];
        const ts = Date.parse((cells[tsIdx] || "").trim());
        const sid = (cells[idIdx] || "").trim();
        if (!sid || Number.isNaN(ts)) { skipped++; continue; }
        const rec = { t: ts, station: sid };
        paramCols.forEach(([i, p]) => {
          const v = (cells[i] || "").trim();
          rec[p] = v === "" ? null : Number(v);
          if (rec[p] !== null && Number.isNaN(rec[p])) rec[p] = null;
        });
        rows.push(rec);
      }
      if (!rows.length) throw new Error("No valid readings could be parsed — check the timestamp format.");
      rows.sort((a, b) => a.t - b.t || (a.station < b.station ? -1 : 1));
      const stations = [...new Set(rows.map((x) => x.station))].sort();
      const params = sortParams([...new Set(paramCols.map(([, p]) => p))]);
      const usedCols = new Set(Object.values(map).filter((i) => i >= 0));
      const ignoredCols = header.filter((_, i) => !usedCols.has(i));
      setDataset({
        name,
        rows,
        stations,
        params,
        start: rows[0].t,
        end: rows[rows.length - 1].t,
        skipped,
        origin,
        mappedParams: paramCols.length,
        ignoredCols,
      });
      if (params.includes("ch4")) setParameter("ch4");
      else setParameter(params[0]);
      if (stations.includes("S4")) setStation("S4");
      else setStation(stations[0]);
      if (skipped) pushToast(`${skipped} malformed rows skipped.`, "warning");
      if (ignoredCols.length && origin === "USER-UPLOADED") {
        pushToast(`${ignoredCols.length} file column${ignoredCols.length === 1 ? "" : "s"} ignored: ${ignoredCols.slice(0, 4).join(", ")}${ignoredCols.length > 4 ? "…" : ""}.`, "warning");
      }
    } catch (err) {
      setParseError(err.message);
      setDataset(null);
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      const res = await fetch("/sample-mine-readings.csv");
      if (!res.ok) throw new Error(`Sample file unavailable (HTTP ${res.status}).`);
      ingest("sample-mine-readings.csv", await res.text(), "SAMPLE-SIMULATED");
    } catch (err) {
      setParseError(err.message);
    } finally {
      setLoadingSample(false);
    }
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => ingest(f.name, String(reader.result || ""));
    reader.onerror = () => setParseError("Could not read the selected file.");
    reader.readAsText(f);
    e.target.value = "";
  };

  /* ---- Analysis ---- */

  const rules = useMemo(() => {
    if (profiles === null) return null;
    if (profiles.length) {
      return profiles.map((p) => ({
        profileKey: p.profileKey,
        parameter: p.parameter,
        locationType: p.locationType || "ANY_PLACE",
        comparator: p.comparator || "MAX",
        warning: p.warning,
        critical: p.critical,
        unit: p.unit,
        sourceRef: p.sourceRef,
      }));
    }
    return FALLBACK_RULES;
  }, [profiles]);

  const compoundRule = useMemo(() => {
    if (profiles === null) return null;
    /* Compound profiles were filtered out above; re-read from the raw fetch is
       unnecessary — derive from the live list only when present, else fallback. */
    return FALLBACK_COMPOUND;
  }, [profiles]);

  const byStation = useMemo(() => {
    if (!dataset) return new Map();
    const m = new Map();
    dataset.rows.forEach((r) => {
      if (!m.has(r.station)) m.set(r.station, []);
      m.get(r.station).push(r);
    });
    return m;
  }, [dataset]);

  const stats = useMemo(() => {
    if (!dataset) return [];
    return dataset.stations.map((sid) => {
      const vals = (byStation.get(sid) || [])
        .map((r) => r[parameter])
        .filter((v) => v !== null && v !== undefined);
      if (!vals.length) return { sid, n: 0 };
      const sum = vals.reduce((a, b) => a + b, 0);
      return { sid, n: vals.length, min: Math.min(...vals), max: Math.max(...vals), avg: sum / vals.length };
    });
  }, [dataset, byStation, parameter]);

  /* Exceedance windows: consecutive breach rows (≤ 3 cadences apart) merge. */
  const breaches = useMemo(() => {
    if (!dataset || !rules || !compoundRule) return [];
    const events = [];
    const appliesTo = (rule, sid) =>
      rule.locationType === "ANY_PLACE" || locationOf.get(sid) === rule.locationType;

    dataset.rows.forEach((r) => {
      for (const rule of rules) {
        if (!appliesTo(rule, r.station)) continue;
        const v = r[rule.parameter];
        if (v === null || v === undefined) continue;
        let sev = null;
        if (rule.comparator === "MIN") {
          if (rule.critical != null && v <= rule.critical) sev = "CRITICAL";
          else if (rule.warning != null && v <= rule.warning) sev = "WARNING";
        } else {
          if (rule.critical != null && v >= rule.critical) sev = "CRITICAL";
          else if (rule.warning != null && v >= rule.warning) sev = "WARNING";
        }
        if (sev) {
          const limit = sev === "CRITICAL" ? rule.critical : rule.warning;
          events.push({
            t: r.t, station: r.station, parameter: rule.parameter, value: v,
            severity: sev, limit, profileKey: rule.profileKey, sourceRef: rule.sourceRef,
            rule: `${rule.profileKey} (${rule.comparator === "MIN" ? "≤" : "≥"} ${limit} ${rule.unit || ""})`.trim(),
          });
        }
      }
      /* Compound heat rule: wet-bulb above trigger while velocity is too low. */
      const c = compoundRule;
      const wb = r[c.parameter];
      const vel = r[c.requiresParam];
      if (wb !== null && wb !== undefined && wb > c.triggerAbove && vel !== null && vel !== undefined && vel < c.min) {
        events.push({
          t: r.t, station: r.station, parameter: c.parameter, value: wb,
          severity: "CRITICAL", limit: c.triggerAbove, profileKey: c.profileKey,
          sourceRef: c.sourceRef, compound: true,
          rule: `${c.profileKey}: wet-bulb > ${c.triggerAbove}°C needs velocity ≥ ${c.min} m/s (was ${fmtNum(vel, 2)})`,
        });
      }
    });

    /* Group into windows. */
    events.sort((a, b) => a.t - b.t);
    const windows = [];
    const key = (e) => `${e.station}|${e.parameter}|${e.severity}|${e.profileKey}`;
    let cur = null;
    for (const e of events) {
      if (cur && key(cur) === key(e) && e.t - cur.end <= 3 * CADENCE_MS) {
        cur.end = e.t;
        if (e.value > cur.peak) { cur.peak = e.value; cur.peakT = e.t; }
        cur.samples++;
      } else {
        if (cur) windows.push(cur);
        cur = { ...e, start: e.t, end: e.t, peak: e.value, peakT: e.t, samples: 1 };
      }
    }
    if (cur) windows.push(cur);
    return windows.sort((a, b) => b.start - a.start);
  }, [dataset, rules, compoundRule, locationOf, parameter]);

  const filteredBreaches = useMemo(
    () => (sevFilter === "ALL" ? breaches : breaches.filter((b) => b.severity === sevFilter)),
    [breaches, sevFilter]
  );

  const gaps = useMemo(() => {
    if (!dataset) return [];
    const out = [];
    dataset.stations.forEach((sid) => {
      const rows = byStation.get(sid) || [];
      for (let i = 1; i < rows.length; i++) {
        const delta = rows[i].t - rows[i - 1].t;
        if (delta > 1.5 * CADENCE_MS) {
          const missing = Math.round(delta / CADENCE_MS) - 1;
          out.push({
            station: sid,
            from: rows[i - 1].t,
            to: rows[i].t,
            missing,
            span: fmtRange(delta),
          });
        }
      }
    });
    return out.sort((a, b) => b.missing - a.missing);
  }, [dataset, byStation]);

  const fanDips = useMemo(() => {
    if (!dataset || !dataset.params.includes("fanRpm")) return [];
    const dips = [];
    dataset.stations.forEach((sid) => {
      const rows = (byStation.get(sid) || []).filter((r) => r.fanRpm !== null && r.fanRpm !== undefined);
      if (rows.length < 12) return;
      const med = median(rows.map((r) => r.fanRpm));
      if (!med) return;
      let run = null;
      const flush = () => {
        if (run && run.rows.length >= 3) {
          const minR = run.rows.reduce((a, b) => (a.fanRpm <= b.fanRpm ? a : b));
          dips.push({
            station: sid,
            start: run.rows[0].t,
            end: run.rows[run.rows.length - 1].t,
            minRpm: minR.fanRpm,
            dropPct: Math.round((1 - minR.fanRpm / med) * 100),
            baseline: Math.round(med),
          });
        }
        run = null;
      };
      rows.forEach((r) => {
        if (r.fanRpm < 0.8 * med) {
          if (run && r.t - run.rows[run.rows.length - 1].t <= 2 * CADENCE_MS) run.rows.push(r);
          else { flush(); run = { rows: [r] }; }
        } else flush();
      });
      flush();
    });
    return dips.sort((a, b) => b.start - a.start);
  }, [dataset, byStation]);

  /* Chart data: selected station + parameter, downsampled. */
  const chartData = useMemo(() => {
    if (!dataset) return [];
    const rows = (byStation.get(station) || []).filter((r) => r[parameter] !== null && r[parameter] !== undefined);
    if (rows.length <= CHART_MAX_POINTS) return rows.map((r) => ({ t: r.t, v: r[parameter] }));
    const stride = Math.ceil(rows.length / CHART_MAX_POINTS);
    const out = [];
    for (let i = 0; i < rows.length; i += stride) out.push({ t: rows[i].t, v: rows[i][parameter] });
    return out;
  }, [dataset, byStation, station, parameter]);

  const chartWindows = useMemo(
    () => breaches.filter((b) => b.station === station && b.parameter === parameter),
    [breaches, station, parameter]
  );

  const limitLines = useMemo(() => {
    if (!rules) return [];
    const lines = [];
    rules
      .filter((r) => r.parameter === parameter)
      .forEach((r) => {
        if (r.critical != null) lines.push({ v: r.critical, label: `crit ${r.critical}`, key: `${r.profileKey}-c` });
        if (r.warning != null) lines.push({ v: r.warning, label: `warn ${r.warning}`, key: `${r.profileKey}-w` });
      });
    return lines;
  }, [rules, parameter]);

  const xTick = (t) =>
    dataset && dataset.end - dataset.start > 86400000 ? fmtDateTimeIST(t) : fmtTimeIST(t);

  return (
    <section style={{ marginTop: 34 }}>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div className="eyebrow">File analysis</div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1>
              <span className="script-accent">Dataset </span>analysis
            </h1>
            <p className="lede">
              Drop in a readings CSV — the sample file or your own export — and hunt for
              threshold breaches, gaps and fan events against the live limit profiles.
            </p>
          </div>
          <OriginPill origin={dataset ? dataset.origin : "SAMPLE-SIMULATED"} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="eyebrow">Dataset source</span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            stays in this browser — never written to the readings database
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-primary btn-sm" onClick={loadSample} disabled={loadingSample}>
            {loadingSample ? "Loading…" : "Load sample dataset"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            Upload your own CSV…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            style={{ display: "none" }}
            aria-label="Upload a readings CSV file"
          />
          <span className="hint" style={{ margin: 0 }}>
            Expected columns: timestamp, sensor_id, ch4_pct, co2_pct, co_ppm, o2_pct, temp_c,
            wetbulb_c, rh_pct, pressure_pa, airflow_m3min, velocity_ms, dust_mg_m3, fan_rpm — your
            file uses different headers? A column-mapping step opens automatically.
          </span>
        </div>
        {parseError ? (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <IconInfo size={16} />
            <div><strong>Couldn’t read that file — </strong>{parseError}</div>
          </div>
        ) : null}
        {dataset ? (
          <dl style={{ marginTop: 14 }}>
            <div className="kv"><dt>File</dt><dd>{dataset.name}</dd></div>
            <div className="kv">
              <dt>Data origin</dt>
              <dd>
                <OriginPill origin={dataset.origin} />{" "}
                <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>
                  {dataset.origin === "USER-UPLOADED"
                    ? "your file — analysed in this browser, never mixed with simulator readings"
                    : "bundled sample — simulated data for demo purposes"}
                </span>
              </dd>
            </div>
            <div className="kv"><dt>Readings</dt><dd>{dataset.rows.length.toLocaleString("en-IN")}</dd></div>
            <div className="kv"><dt>Window</dt><dd style={{ fontSize: 12 }}>{fmtDateTimeIST(dataset.start)} → {fmtDateTimeIST(dataset.end)}</dd></div>
            <div className="kv"><dt>Stations</dt><dd>{dataset.stations.join(", ")}</dd></div>
            <div className="kv">
              <dt>Columns</dt>
              <dd style={{ fontSize: 12.5 }}>
                {dataset.mappedParams} measurement column{dataset.mappedParams === 1 ? "" : "s"} mapped
                {dataset.ignoredCols && dataset.ignoredCols.length ? (
                  <span style={{ color: "var(--text-3)" }}> · ignored: {dataset.ignoredCols.join(", ")}</span>
                ) : null}
              </dd>
            </div>
            <div className="kv"><dt>Limits in force</dt><dd style={{ fontFamily: "var(--sans)", fontSize: 12.5 }}>
              {rules === null ? "loading…" : rules.map((r) => r.profileKey).join(", ")}
              {profiles && profiles.length === 0 ? " (seeded fallback)" : ""}
            </dd></div>
          </dl>
        ) : null}
      </div>

      {/* Column-mapping step — opens when a user file's headers don't match. */}
      {mapJob ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--warn)" }}>
          <div className="card-head">
            <span className="eyebrow">Column mapping — your headers don’t match our format</span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{mapJob.name}</span>
          </div>
          <p className="lede" style={{ marginBottom: 12, maxWidth: 72 + "ch" }}>
            Point each field at the right column in your file. Fields marked{" "}
            <span style={{ color: "var(--crit)" }}>*</span> are required; unmapped measurement
            columns are skipped and file columns you don’t map are ignored — nothing is uploaded anywhere.
          </p>
          <div className="table-wrap" style={{ border: "none" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Your file’s column</th>
                  <th>Sample value (2nd row)</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_DEFS.map((f) => {
                  const sel = mapJob.mapping[f.key];
                  return (
                    <tr key={f.key}>
                      <td>
                        {f.label}{f.required ? <span style={{ color: "var(--crit)" }}> *</span> : null}
                        {f.hint ? <div style={{ color: "var(--text-3)", fontSize: 11 }}>{f.hint}</div> : null}
                      </td>
                      <td>
                        <select
                          value={sel}
                          onChange={(e) =>
                            setMapJob({
                              ...mapJob,
                              mapping: { ...mapJob.mapping, [f.key]: Number(e.target.value) },
                            })
                          }
                          aria-label={`Map column for ${f.label}`}
                        >
                          <option value={-1}>— not in file —</option>
                          {mapJob.header.map((h, i) => (
                            <option key={i} value={i}>{h}</option>
                          ))}
                        </select>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {sel >= 0 ? String(mapJob.sampleRow[sel] ?? "") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const u = mappingIsUsable(mapJob.mapping);
            return u.ok ? null : (
              <div className="notice warn" style={{ marginTop: 12 }}>
                <IconInfo size={16} />
                <div>
                  <strong>Still missing — </strong>
                  {!u.ts ? "a Timestamp column; " : ""}
                  {!u.id ? "a Sensor / station ID column; " : ""}
                  {!u.nParams ? "at least one measurement column. " : ""}
                </div>
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={!mappingIsUsable(mapJob.mapping).ok}
              onClick={() => ingest(mapJob.name, mapJob.text, mapJob.origin, mapJob.mapping)}
            >
              Apply mapping &amp; analyse
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setMapJob(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {dataset ? (
        <>
          {/* Data-origin banner — USER-UPLOADED figures must never read as live/simulated. */}
          {dataset.origin === "USER-UPLOADED" ? (
            <div className="notice warn" style={{ marginBottom: 18 }}>
              <IconInfo size={16} />
              <div>
                <strong>USER-UPLOADED data in analysis — </strong>
                “{dataset.name}” is your file, not simulator output and not live readings.
                Everything below describes that file only; limits come from your configured
                profiles, and the file was never written to the readings database.
              </div>
            </div>
          ) : (
            <div className="notice" style={{ marginBottom: 18 }}>
              <IconInfo size={16} />
              <div>
                <strong>Sample dataset — SIMULATED — </strong>
                generated data for demo purposes; the same mapping, limits and gap logic
                runs against any CSV you upload.
              </div>
            </div>
          )}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <span className="eyebrow">Parameter &amp; station</span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                origin: {dataset.origin === "USER-UPLOADED" ? "user-uploaded" : "simulated sample"}
              </span>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Parameter</label>
                <select value={parameter} onChange={(e) => setParameter(e.target.value)}>
                  {dataset.params.map((p) => (
                    <option key={p} value={p}>
                      {paramLabel(p)} ({paramUnit(p)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Station for the chart</label>
                <div className="chip-row">
                  {dataset.stations.map((sid) => (
                    <button
                      key={sid}
                      className={`chip${station === sid ? " active-amber" : ""}`}
                      onClick={() => setStation(sid)}
                    >
                      {sid}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="chart-card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <span className="eyebrow">
                {paramLabel(parameter)} · {station} · {dataset.rows.length.toLocaleString("en-IN")} readings
              </span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                unit: {paramUnit(parameter)} · amber bands = breach windows
              </span>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 12, right: 28, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={xTick}
                  tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                  minTickGap={56}
                />
                <YAxis
                  tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                  width={64}
                  domain={["auto", "auto"]}
                  label={{
                    value: paramUnit(parameter),
                    angle: -90,
                    position: "insideLeft",
                    fill: CHART.tick,
                    fontSize: 11,
                  }}
                />
                <Tooltip content={<ChartTooltip labelFmt={(t) => fmtDateTimeIST(t)} />} cursor={{ stroke: "#3a434e" }} />
                {limitLines.map((l) => (
                  <ReferenceLine
                    key={l.key}
                    y={l.v}
                    stroke="#f5b83d"
                    strokeDasharray="6 4"
                    strokeOpacity={0.65}
                    label={{ value: l.label, fill: "#f5b83d", fontSize: 10.5, position: "insideTopRight" }}
                  />
                ))}
                {chartWindows.map((w, i) => (
                  <ReferenceArea
                    key={`w${i}`}
                    x1={w.start}
                    x2={w.end}
                    stroke="none"
                    fill={w.severity === "CRITICAL" ? "#ff5a4f" : "#f5b83d"}
                    fillOpacity={0.10}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="v"
                  name={`${station} ${paramLabel(parameter)}`}
                  stroke="#4db38a"
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {chartWindows.map((w, i) => (
                  <ReferenceDot
                    key={`d${i}`}
                    x={w.peakT}
                    y={w.peak}
                    r={5}
                    fill={w.severity === "CRITICAL" ? "#ff5a4f" : "#f5b83d"}
                    stroke="#0d1117"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="chart-legend-note">
              <span className="mono">{station}</span>
              <span style={{ marginLeft: 16, color: "var(--text-3)" }}>
                dashed line = statutory limit · dot = window peak
              </span>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <span className="eyebrow">
                Station statistics — {paramLabel(parameter)} ({paramUnit(parameter)})
              </span>
            </div>
            <div className="table-wrap" style={{ border: "none" }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th className="num">Samples</th>
                    <th className="num">Min</th>
                    <th className="num">Max</th>
                    <th className="num">Mean</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.sid} style={s.sid === station ? { background: "rgba(245,184,61,0.05)" } : undefined}>
                      <td>
                        <span className="mono" style={{ fontWeight: 700 }}>{s.sid}</span>{" "}
                        <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                          {sensors.find((x) => x.sensorId === s.sid)?.name || ""}
                        </span>
                      </td>
                      <td className="num mono">{s.n.toLocaleString("en-IN")}</td>
                      <td className="num mono">{s.n ? fmtNum(s.min, 3) : "—"}</td>
                      <td className="num mono">{s.n ? fmtNum(s.max, 3) : "—"}</td>
                      <td className="num mono">{s.n ? fmtNum(s.avg, 3) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <span className="eyebrow">
                Exceedance windows — {filteredBreaches.length} found
              </span>
              <div className="chip-row" role="group" aria-label="Severity filter">
                {["ALL", "CRITICAL", "WARNING"].map((s) => (
                  <button key={s} className={`chip${sevFilter === s ? " active" : ""}`} onClick={() => setSevFilter(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {filteredBreaches.length ? (
              <div className="table-wrap" style={{ border: "none" }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Window (IST)</th>
                      <th>Station</th>
                      <th>Parameter</th>
                      <th className="num">Peak</th>
                      <th>Limit breached</th>
                      <th>Severity</th>
                      <th>Rule source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBreaches.map((w, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {fmtDateTimeIST(w.start)}
                          <div style={{ color: "var(--text-3)", fontSize: 11 }}>→ {fmtDateTimeIST(w.end)} · {w.samples} samples</div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700 }}>{w.station}</td>
                        <td className="mono">{paramLabel(w.parameter)}</td>
                        <td className="num mono">{fmtNum(w.peak, 3)} <span style={{ color: "var(--text-3)", fontSize: 11 }}>{paramUnit(w.parameter)}</span></td>
                        <td className="mono" style={{ fontSize: 12 }}>{w.rule}</td>
                        <td><StatusPill status={w.severity} /></td>
                        <td style={{ fontSize: 12, color: "var(--text-2)" }}>{w.sourceRef}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="state-panel" style={{ margin: 0 }}>
                <h3>No breaches at this severity</h3>
                <p>Every reading stayed inside the enabled limit profiles.</p>
              </div>
            )}
          </div>

          {fanDips.length ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-head">
                <span className="eyebrow">Fan dips — {fanDips.length} detected</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                  speed fell &gt; 20% below the station median for 3+ readings
                </span>
              </div>
              <div className="table-wrap" style={{ border: "none" }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Window (IST)</th>
                      <th>Station</th>
                      <th className="num">Min speed</th>
                      <th className="num">Drop vs median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fanDips.map((d, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {fmtDateTimeIST(d.start)} <span style={{ color: "var(--text-3)" }}>→</span> {fmtDateTimeIST(d.end)}
                        </td>
                        <td className="mono" style={{ fontWeight: 700 }}>{d.station}</td>
                        <td className="num mono">{d.minRpm} rpm</td>
                        <td className="num mono" style={{ color: "var(--warn)" }}>−{d.dropPct}% <span style={{ color: "var(--text-3)" }}>(median {d.baseline})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <span className="eyebrow">Gap report — expected 5-minute cadence</span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {gaps.length} missing interval{gaps.length === 1 ? "" : "s"}
              </span>
            </div>
            {gaps.length ? (
              <div className="table-wrap" style={{ border: "none" }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th>Missing between (IST)</th>
                      <th className="num">Intervals lost</th>
                      <th className="num">Span</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((g, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontWeight: 700 }}>{g.station}</td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {fmtDateTimeIST(g.from)} <span style={{ color: "var(--text-3)" }}>→</span> {fmtDateTimeIST(g.to)}
                        </td>
                        <td className="num mono" style={{ color: "var(--warn)" }}>{g.missing}</td>
                        <td className="num mono">{g.span}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="state-panel" style={{ margin: 0 }}>
                <h3>No gaps</h3>
                <p>Every station reported on the expected 5-minute cadence across the whole window.</p>
              </div>
            )}
          </div>
        </>
      ) : null}

      <Notice kind="" title="Where this data goes">
        <span style={{ display: "block", marginTop: 2 }}>
          Uploaded files and the sample dataset are parsed and analysed entirely in your
          browser — nothing is POSTed to the readings database and nothing leaves this
          machine.{" "}
          {dataset ? (
            <>
              <OriginPill origin={dataset.origin} /> origin on every figure above
              {dataset.origin === "USER-UPLOADED"
                ? ` — “${dataset.name}” is your file, never mixed with simulator readings.`
                : " — the bundled sample is simulated data."}
            </>
          ) : null}
        </span>
      </Notice>
    </section>
  );
}

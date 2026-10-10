import React, { useEffect, useState } from "react";
import { downloadBlob, Sensors as SensorsApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ui/toast";
import { Notice, PageHeader } from "../ui/primitives";
import { IconDownload, IconInfo } from "../ui/icons";

const toISO = (local) => {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/* 7 typed reports — every one exports CSV and PDF via /reports/:type?format=csv|pdf.
   Plus the two raw CSV register exports. Paths must match server/src/routes/reports.js. */
const REPORTS = [
  {
    id: "daily-ventilation",
    path: "/reports/daily-ventilation",
    name: "Daily ventilation report",
    desc: "Per-sensor, per-parameter avg/min/max with alert and audit sections. CSV or PDF.",
    filters: ["from", "to"],
  },
  {
    id: "sensor",
    path: "/reports/sensor",
    name: "Sensor report",
    desc: "One station: details, parameter statistics and the latest 50 readings. Pick the station above.",
    filters: ["sensor", "from", "to"],
  },
  {
    id: "incident",
    path: "/reports/incident",
    name: "Incident report",
    desc: "Alert register for the window — trigger/peak values, acknowledgement and resolution.",
    filters: ["from", "to"],
  },
  {
    id: "airflow-survey",
    path: "/reports/airflow-survey",
    name: "Airflow survey report",
    desc: "Live branch airflows at generation plus airflow-station statistics for the window.",
    filters: ["from", "to"],
  },
  {
    id: "gas-monitoring",
    path: "/reports/gas-monitoring",
    name: "Gas monitoring report",
    desc: "CH₄/CO₂/CO/O₂ statistics for S4/S5/S6 with the gas alerts opened in the window.",
    filters: ["from", "to"],
  },
  {
    id: "fan-performance",
    path: "/reports/fan-performance",
    name: "Fan performance report",
    desc: "Main and auxiliary fans: duty points, rpm, efficiency, power and runtime hours.",
    filters: ["from", "to"],
  },
  {
    id: "compliance-calc",
    path: "/reports/compliance-calc",
    name: "Compliance calculation report",
    desc: "Air-quantity compliance with working steps, factors and threshold provenance.",
    filters: ["from", "to"],
  },
  {
    id: "readings",
    path: "/reports/readings.csv",
    name: "Raw readings export",
    desc: "One row per reading with units, generatedAt and the safety notice. CSV only.",
    filters: ["sensor", "from", "to"],
    csvOnly: true,
  },
  {
    id: "alerts",
    path: "/reports/alerts.csv",
    name: "Raw alert register",
    desc: "Every alert row with lifecycle timestamps. CSV only.",
    filters: ["from", "to"],
    csvOnly: true,
  },
];

export default function ReportsPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const [sensors, setSensors] = useState([]);
  const [sensorId, setSensorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(null);

  const canExport = hasRole("Operator");

  useEffect(() => {
    SensorsApi.list()
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.data || [];
        setSensors(list);
        // The sensor report requires a sensorId — preselect the first station
        // so the download never 400s on the default "All stations" choice.
        if (list.length && !sensorId) setSensorId(list[0].sensorId || list[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dl = async (rep, format) => {
    const key = `${rep.id}.${format}`;
    setBusy(key);
    try {
      const q = { format };
      if (rep.filters.includes("sensor") && sensorId) q.sensorId = sensorId;
      if (rep.filters.includes("from")) q.from = toISO(from);
      if (rep.filters.includes("to")) q.to = toISO(to);
      const fname = `${rep.id}-${sensorId || "all"}-${from || "start"}-${to || "now"}.${format}`;
      await downloadBlob(rep.path, q, fname);
      pushToast(`${rep.name} (${format.toUpperCase()}) downloaded.`, "success");
    } catch (err) {
      pushApiError(err, `${rep.name} export failed.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Evidence"
        scriptWord="Export"
        title="reports"
        lede="Seven report types, each available as CSV or PDF. Exports carry a units column and a safety notice; the server stamps generation time."
      />

      <Notice kind="warn" title="Safety notice">
        Exports from this prototype contain <strong>simulated data</strong>. Each file carries a
        safety notice — keep it when forwarding. Academic prototype — not a certified
        mine-safety system.
      </Notice>

      {!canExport ? (
        <Notice kind="" title="Export locked">
          Export needs the Operator role or above. You are signed in with a read-only role — ask
          an operator to generate the export you need.
        </Notice>
      ) : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="eyebrow">Shared filters</span>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div className="field">
            <label htmlFor="rep-sensor">Station <span className="unit-tag">readings report</span></label>
            <select
              id="rep-sensor"
              value={sensorId}
              onChange={(e) => setSensorId(e.target.value)}
              disabled={!canExport}
            >
              <option value="">All stations</option>
              {sensors.map((s) => (
                <option key={s.sensorId || s.id} value={s.sensorId || s.id}>
                  {s.sensorId || s.id} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-from">From <span className="unit-tag">IST</span></label>
            <input
              id="rep-from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={!canExport}
            />
          </div>
          <div className="field">
            <label htmlFor="rep-to">To <span className="unit-tag">IST</span></label>
            <input
              id="rep-to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={!canExport}
            />
          </div>
        </div>
      </div>

      <div className="fault-grid">
        {REPORTS.map((rep) => (
          <div className="fault-card" key={rep.id}>
            <div className="f-id mono">{rep.id.toUpperCase()}</div>
            <div className="f-name">{rep.name}</div>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: "8px 0 14px", minHeight: 40 }}>
              {rep.desc}
            </p>
            <div className="f-meta" style={{ marginBottom: 12 }}>
              {rep.filters.map((f) => (
                <span className="pill neutral" key={f}>{f === "from" ? "from/to" : f === "to" ? "" : f}</span>
              ))}
              {rep.filters.length === 0 ? <span className="pill neutral">snapshot</span> : null}
            </div>
            <div className="btn-row">
              <button
                className="btn btn-primary btn-sm"
                disabled={!canExport || busy}
                onClick={() => dl(rep, "csv")}
              >
                <IconDownload size={13} /> {busy === `${rep.id}.csv` ? "Preparing…" : "CSV"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!canExport || busy || rep.csvOnly}
                title={rep.csvOnly ? "CSV only for raw exports" : undefined}
                onClick={() => dl(rep, "pdf")}
              >
                <IconDownload size={13} /> {busy === `${rep.id}.pdf` ? "Preparing…" : "PDF"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-gap">
        <Notice kind="" title="Verification">
          <IconInfo size={16} />
          <div>
            Every export names the threshold versions and source references in force when it was
            generated — one click from the numbers to their provenance.
          </div>
        </Notice>
      </div>
    </>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Overview as OverviewApi, ApiError } from "../lib/api";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import {
  LoadingPanel,
  Notice,
  PageHeader,
  StatePanel,
  StatusPill,
} from "../ui/primitives";
import { ageOf, fmtDateTimeIST, fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

/* 10 KPI definitions from /overview kpis — each clickable → map layer / analytics. */
const KPI_DEFS = [
  { key: "airQuantityM3min", label: "Air quantity", unit: "m³/min", digits: 0, layer: "AIRFLOW" },
  { key: "velocityMs", label: "Velocity", unit: "m/s", digits: 2, layer: "AIRFLOW" },
  { key: "ch4Pct", label: "CH₄", unit: "%vol", digits: 3, layer: "CH4" },
  { key: "co2Pct", label: "CO₂", unit: "%vol", digits: 3, layer: "CO2" },
  { key: "coPpm", label: "CO", unit: "ppm", digits: 1, layer: "CO" },
  { key: "o2Pct", label: "O₂", unit: "%vol", digits: 2, layer: "O2" },
  { key: "tempC", label: "Dry-bulb temp", unit: "°C", digits: 1, layer: "TEMPERATURE" },
  { key: "wetBulbC", label: "Wet-bulb temp", unit: "°C", digits: 1, layer: "TEMPERATURE" },
  { key: "rhPct", label: "Rel. humidity", unit: "%", digits: 1, layer: "HUMIDITY" },
  { key: "pressurePa", label: "Static pressure", unit: "Pa", digits: 0, layer: "PRESSURE" },
];

function KpiCard({ def, value, severity, onClick }) {
  return (
    <div
      className={`kpi-card sev-${String(severity || "NORMAL").toUpperCase()}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      title={`Open ${def.layer} layer on the network map`}
    >
      <div className="kpi-label">{def.label}</div>
      <div className="kpi-value live-value">
        {value === null || value === undefined ? "—" : fmtNum(value, def.digits)}
        <span className="unit">{def.unit}</span>
      </div>
      <div className="kpi-meta">
        <span className="loc">worst case · mine-wide</span>
        <span className="mono">{severity && severity !== "NORMAL" ? severity.toLowerCase() : "normal"}</span>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { pushApiError } = useToast();
  const { readings, statuses, overallStatus, recentAlerts, sim } = useRealtime();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await OverviewApi.get();
      setData(d);
      setError(null);
    } catch (err) {
      setError(err);
      if (firstLoad.current) pushApiError(err, "Failed to load overview.");
    } finally {
      setLoading(false);
      firstLoad.current = false;
    }
  }, [pushApiError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Merge socket-fresh values: prefer sim:tick kpis, then polled snapshot. */
  const kpis = useMemo(() => {
    const src = sim.kpis || data?.kpis || {};
    return src;
  }, [sim.kpis, data]);

  const effOverall = overallStatus || sim.overallStatus || data?.overallStatus || "NORMAL";

  const activeAlerts = useMemo(() => {
    const fromApi = data?.activeAlerts || [];
    const map = new Map();
    fromApi.forEach((a) => map.set(a.alertId, a));
    recentAlerts.forEach((a) => {
      if (a?.alertId && (a.status === "ACTIVE" || a.status === "ACKNOWLEDGED")) map.set(a.alertId, a);
    });
    return [...map.values()].slice(0, 8);
  }, [data, recentAlerts]);

  const openLayer = (layer) => navigate("/network", { state: { layer } });

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Control room" scriptWord="Shift" title="overview" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !data && !sim.kpis) {
    return (
      <>
        <PageHeader eyebrow="Control room" scriptWord="Shift" title="overview" />
        <StatePanel
          title="Overview unavailable"
          requestId={error.requestId}
          onRetry={load}
          icon={<IconInfo size={30} />}
        >
          {error instanceof ApiError && error.status === 401
            ? "Your session has expired. Please sign in again."
            : error.message}
        </StatePanel>
      </>
    );
  }

  const bannerCls = effOverall === "NORMAL" ? "ok" : effOverall === "CRITICAL" ? "critical" : "degraded";

  return (
    <>
      <PageHeader
        eyebrow="Control room"
        scriptWord="Shift"
        title="overview"
        lede="Mine-wide worst-case indicators, live sensor health and the active alert queue. Click any indicator to open its layer on the network map. All times IST."
        right={
          <span className="live-tag">
            <span className="dot" /> live
          </span>
        }
      />

      <div className={`overall-banner ${bannerCls}`}>
        <StatusPill status={effOverall} />
        <div>
          <div className="big">
            {effOverall === "NORMAL" ? "Ventilation normal" : effOverall === "CRITICAL" ? "Ventilation critical" : "Ventilation degraded"}
          </div>
          <div className="sub">
            {sim.simTime ? (
              <span className="mono">sim time {fmtDateTimeIST(sim.simTime)}</span>
            ) : null}
            {data?.serverTime ? (
              <span className="mono"> · server time {fmtDateTimeIST(data.serverTime)}</span>
            ) : null}
            {sim.scenario ? <span> · scenario: <b>{sim.scenario}</b></span> : null}
            {(sim.activeFaults?.length || 0) > 0 ? (
              <span> · <b style={{ color: "var(--crit)" }}>{sim.activeFaults.length} active fault(s)</b></span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        {KPI_DEFS.map((def) => (
          <KpiCard
            key={def.key}
            def={def}
            value={kpis[def.key]}
            severity={kpis[`${def.key}Severity`] || kpis.severity || "NORMAL"}
            onClick={() => openLayer(def.layer)}
          />
        ))}
      </div>

      <Notice kind="" title="Data origin">
        Every reading on this page is <span className="pill sim">simulated</span> — generated by the
        in-process simulator for research. Not mine instrumentation.
      </Notice>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Active alerts</span>
            <Link to="/alerts" className="mono" style={{ fontSize: 12 }}>
              alert desk →
            </Link>
          </div>
          {activeAlerts.length === 0 ? (
            <div style={{ color: "var(--text-3)", fontSize: 13, padding: "18px 4px" }}>
              No active alerts. The board is quiet — stale-sensor sweeps and gas-limit breaches will
              appear here the moment they open.
            </div>
          ) : (
            <div className="table-wrap" style={{ border: "none" }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>What</th>
                    <th className="num">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAlerts.map((a) => (
                    <tr key={a.alertId}>
                      <td><StatusPill status={a.severity} /></td>
                      <td>
                        <span className="mono" style={{ fontWeight: 700 }}>{a.sensorId}</span>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                          {a.parameter} · {a.type}
                        </div>
                      </td>
                      <td className="num mono">
                        {a.triggerValue != null ? fmtNum(a.triggerValue, 2) : "—"}
                      </td>
                      <td><StatusPill status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-3)" }}>
            Acknowledgement needs the Operator role or above — see the alert desk.
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Simulator state</span>
            <Link to="/simulation" className="mono" style={{ fontSize: 12 }}>
              simulation desk →
            </Link>
          </div>
          <dl>
            <div className="kv"><dt>Running</dt><dd>{sim.running == null ? "—" : sim.running ? "yes" : "no"}</dd></div>
            <div className="kv"><dt>Paused</dt><dd>{sim.paused == null ? "—" : sim.paused ? "yes" : "no"}</dd></div>
            <div className="kv"><dt>Speed</dt><dd>{sim.speed != null ? `${sim.speed}×` : "—"}</dd></div>
            <div className="kv"><dt>Tick</dt><dd>{sim.tickMs != null ? `${sim.tickMs} ms` : "—"}</dd></div>
            <div className="kv"><dt>Required air qty</dt><dd>{sim.Qreq != null ? `${fmtNum(sim.Qreq, 1)} m³/min` : "—"}</dd></div>
            <div className="kv"><dt>Active faults</dt><dd>{(sim.activeFaults || []).length}</dd></div>
          </dl>
          <div style={{ marginTop: 10 }}>
            <Link to="/network" className="btn btn-ghost btn-sm">Open network map →</Link>
          </div>
        </div>
      </div>
    </>
  );
}

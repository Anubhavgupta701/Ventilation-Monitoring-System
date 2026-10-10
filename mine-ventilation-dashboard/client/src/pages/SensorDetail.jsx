import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sensors as SensorsApi, Thresholds } from "../lib/api";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import {
  CHART,
  ChartTooltip,
  CrumbLink,
  LoadingPanel,
  Notice,
  PageHeader,
  StatePanel,
  StatusPill,
} from "../ui/primitives";
import {
  ageOf,
  fmtDateIST,
  fmtDateTimeIST,
  fmtNum,
  fmtParamValue,
  fmtTimeIST,
  locationLabel,
  paramLabel,
  paramUnit,
  sortParams,
} from "../lib/format";
import { IconInfo } from "../ui/icons";

const RANGES = ["1h", "6h", "24h", "7d"];

/* Enabled-profile selection: matching {parameter, locationType}, highest version. */
function matchProfiles(profiles, parameter, locationType) {
  return (profiles || [])
    .filter(
      (p) =>
        p.enabled &&
        p.parameter === parameter &&
        (p.locationType === locationType || p.locationType === "ANY_PLACE")
    )
    .sort((a, b) => (b.version || 0) - (a.version || 0));
}

function thresholdLabel(p, kind) {
  const v = kind === "warning" ? p.warning : p.critical;
  if (v === null || v === undefined) return null;
  return `${paramLabel(p.parameter)} ${kind} ${v} ${p.unit || ""} — ${p.sourceRef || "no source"}`;
}

export default function SensorDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const histTo = searchParams.get("to"); // time-machine deep link
  const { pushApiError } = useToast();
  const { readings, statuses } = useRealtime();
  const [detail, setDetail] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [range, setRange] = useState("1h");
  const [param, setParam] = useState(null);
  const [buckets, setBuckets] = useState(null);
  const [error, setError] = useState(null);
  const [chartError, setChartError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([SensorsApi.get(id), Thresholds.list()]);
      setDetail(d);
      setProfiles(Array.isArray(t) ? t : t?.data || []);
      const params = sortParams(d?.sensor?.parameters || []);
      setParam((prev) => (prev && params.includes(prev) ? prev : params[0] || null));
      setError(null);
    } catch (err) {
      setError(err);
      if (loading) pushApiError(err, "Failed to load sensor.");
    } finally {
      setLoading(false);
    }
  }, [id, loading, pushApiError]);

  const loadReadings = useCallback(async () => {
    if (!param) return;
    setChartLoading(true);
    try {
      const d = await SensorsApi.readings(id, { range, to: histTo || undefined, parameter: param });
      setBuckets(d?.buckets || []);
      setChartError(null);
    } catch (err) {
      setChartError(err);
    } finally {
      setChartLoading(false);
    }
  }, [id, range, param, histTo]);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    loadDetail();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadReadings();
  }, [loadReadings]);

  const sensor = detail?.sensor;
  const liveReading = readings[id];
  const liveStatus = statuses[id]?.status || sensor?.status || "OFFLINE";
  const latestValues =
    liveReading?.values || detail?.latestReading?.values || detail?.latestReading || null;
  const measuredAt = liveReading?.measuredAt || detail?.latestReading?.measuredAt;
  const quality = liveReading?.quality || detail?.latestReading?.quality || "NORMAL";

  /* instrument metadata — calibration, signal, battery, comms, data quality */
  const meta = useMemo(() => {
    const s = sensor || {};
    return {
      calibrationDate: s.calibrationDate || s.lastCalibration,
      calibrationDue: s.calibrationDue || null,
      signalDbm: s.signalDbm ?? liveReading?.signalDbm ?? null,
      batteryPct: s.batteryPct ?? liveReading?.batteryPct ?? null,
      comms: s.comms || liveReading?.comms || (String(liveStatus).toUpperCase() === "OFFLINE" ? "LOST" : "OK"),
      dataQuality: quality,
      firmware: s.firmware || s.firmwareVersion || null,
      commsPath: s.commsPath || null,
    };
  }, [sensor, liveReading, quality, liveStatus]);

  const commLost = meta.comms === "LOST" || String(liveStatus).toUpperCase() === "OFFLINE";

  const matched = useMemo(
    () => (param && sensor ? matchProfiles(profiles, param, sensor.locationType) : []),
    [profiles, param, sensor]
  );
  const activeProfile = matched[0] || null;

  const chartData = useMemo(() => {
    if (!buckets) return [];
    return buckets.map((b) => ({
      t: b.t,
      v: b.values && param ? b.values[param] ?? null : null,
    }));
  }, [buckets, param]);

  const yDomain = useMemo(() => {
    const vals = chartData.map((d) => d.v).filter((v) => v !== null && v !== undefined);
    const extras = [];
    if (activeProfile?.warning != null) extras.push(activeProfile.warning);
    if (activeProfile?.critical != null) extras.push(activeProfile.critical);
    const all = [...vals, ...extras];
    if (!all.length) return ["auto", "auto"];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }, [chartData, activeProfile]);

  const xTick = (t) => {
    if (range === "7d") return `${fmtDateIST(t).replace(/ \d{4}$/, "")} ${fmtTimeIST(t)}`;
    return fmtTimeIST(t);
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Instrumentation" title={id} />
        <LoadingPanel />
      </>
    );
  }

  if (error && !detail) {
    return (
      <>
        <PageHeader eyebrow="Instrumentation" title={id} />
        <CrumbLink to="/sensors">sensors</CrumbLink>
        <StatePanel
          title={error.status === 404 ? "Station not found" : "Sensor unavailable"}
          requestId={error.requestId}
          onRetry={loadDetail}
          icon={<IconInfo size={30} />}
        >
          {error.message}
        </StatePanel>
      </>
    );
  }

  const params = sortParams(sensor?.parameters || []);

  return (
    <>
      <PageHeader
        eyebrow="Instrumentation"
        scriptWord="Station"
        title={`${sensor?.name || id}`}
        lede={
          <>
            <CrumbLink to="/sensors">sensors</CrumbLink>
            {"  ·  "}
            <span className="mono">{id}</span> · {locationLabel(sensor?.locationType)}
            {sensor?.branchId ? <> · branch <span className="mono">{sensor.branchId}</span></> : null}
          </>
        }
        right={<StatusPill status={liveStatus} />}
      />

      {histTo ? (
        <Notice kind="warn" title="Historical view">
          Trend window ends at <span className="mono">{fmtDateTimeIST(histTo)}</span> (time-machine link).
          <Link to={`/sensors/${id}`} style={{ marginLeft: 8 }}>Back to live →</Link>
        </Notice>
      ) : null}

      {commLost ? (
        <div className="notice crit" role="alert">
          <IconInfo size={16} />
          <div>
            <strong>COMM LOST — </strong>no telemetry from {id}
            {measuredAt ? (
              <> since <span className="mono">{fmtDateTimeIST(measuredAt)}</span> ({ageOf(measuredAt)} ago)</>
            ) : (
              " (no reading on record)"
            )}.
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { loadDetail(); loadReadings(); }}>
                Retry link
              </button>
              <Link className="btn btn-ghost btn-sm" to="/alerts">
                Open alert desk
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* live values */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="eyebrow">Live values {quality !== "NORMAL" ? `· quality ${quality}` : ""}</span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {measuredAt ? `measured ${fmtDateTimeIST(measuredAt)} (${ageOf(measuredAt)} ago)` : "no readings yet"}
          </span>
        </div>
        {latestValues ? (
          <div className="value-grid">
            {params.map((p) => (
              <div key={p} className="value-cell">
                <div className="p">{paramLabel(p)}</div>
                <div className="v live-value">
                  {fmtParamValue(p, latestValues[p])}
                  <span className="unit">{paramUnit(p)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>No readings received yet for this station.</div>
        )}
      </div>

      {/* instrument metadata */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="eyebrow">Instrument metadata</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
            calibration · signal · battery · comms · data quality
          </span>
        </div>
        <div className="grid-3">
          <dl>
            <div className="kv"><dt>Calibration date</dt><dd>{meta.calibrationDate ? fmtDateIST(meta.calibrationDate) : "—"}</dd></div>
            <div className="kv"><dt>Calibration due</dt><dd>{meta.calibrationDue ? fmtDateIST(meta.calibrationDue) : "—"}</dd></div>
            <div className="kv"><dt>Firmware</dt><dd>{meta.firmware || "—"}</dd></div>
          </dl>
          <dl>
            <div className="kv"><dt>Signal</dt><dd>{meta.signalDbm != null ? `${fmtNum(meta.signalDbm, 0)} dBm` : "—"}</dd></div>
            <div className="kv"><dt>Battery</dt><dd>{meta.batteryPct != null ? `${fmtNum(meta.batteryPct, 0)} %` : "—"}</dd></div>
            <div className="kv"><dt>Comms path</dt><dd>{meta.commsPath || "—"}</dd></div>
          </dl>
          <dl>
            <div className="kv"><dt>Comms</dt><dd>{meta.comms}</dd></div>
            <div className="kv"><dt>Data quality</dt><dd>{meta.dataQuality}</dd></div>
            <div className="kv"><dt>Status</dt><dd>{liveStatus}</dd></div>
          </dl>
        </div>
      </div>

      {/* trend chart */}
      <div className="chart-card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="eyebrow">Trend — gaps shown as breaks</span>
          <div className="chip-row">
            {RANGES.map((r) => (
              <button key={r} className={`chip${range === r ? " active" : ""}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {params.map((p) => (
            <button key={p} className={`chip${param === p ? " active-amber" : ""}`} onClick={() => setParam(p)}>
              {paramLabel(p)}
            </button>
          ))}
        </div>

        {chartError ? (
          <StatePanel title="Trend unavailable" requestId={chartError.requestId} onRetry={loadReadings} icon={<IconInfo size={26} />}>
            {chartError.message}
          </StatePanel>
        ) : chartLoading && !buckets ? (
          <LoadingPanel label="Loading trend…" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 12, right: 28, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tickFormatter={xTick}
                  tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                  minTickGap={48}
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                  width={64}
                  label={{
                    value: paramUnit(param),
                    angle: -90,
                    position: "insideLeft",
                    fill: CHART.tick,
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  content={<ChartTooltip labelFmt={(t) => fmtDateTimeIST(t)} />}
                  cursor={{ stroke: "#c9bda2" }}
                />
                {activeProfile?.warning != null ? (
                  <ReferenceLine
                    y={activeProfile.warning}
                    stroke="#b97e14"
                    strokeDasharray="6 4"
                    label={{
                      value: thresholdLabel(activeProfile, "warning"),
                      position: "insideTopRight",
                      fill: "#b97e14",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                ) : null}
                {activeProfile?.critical != null ? (
                  <ReferenceLine
                    y={activeProfile.critical}
                    stroke="#b3372a"
                    strokeDasharray="6 4"
                    label={{
                      value: thresholdLabel(activeProfile, "critical"),
                      position: "insideTopRight",
                      fill: "#b3372a",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="v"
                  name={`${paramLabel(param)} (${paramUnit(param)})`}
                  stroke="#8a5a24"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="chart-legend-note">
              {activeProfile ? (
                <>
                  Threshold lines from <span className="mono">{activeProfile.profileKey} v{activeProfile.version}</span>{" "}
                  — <Link to="/thresholds">threshold provenance</Link>
                  {activeProfile.ruleType === "compound" && activeProfile.condition ? (
                    <span>
                      {" "}· compound rule: triggers above {activeProfile.condition.triggerAbove}{" "}
                      {activeProfile.condition.unit} when {paramLabel(activeProfile.condition.requiresParam)} &lt;{" "}
                      {activeProfile.condition.min} {activeProfile.condition.minUnit || activeProfile.condition.unit}
                    </span>
                  ) : null}
                </>
              ) : (
                <>No enabled threshold profile matches {paramLabel(param)} at this location class.</>
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid-2">
        {/* threshold provenance */}
        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Threshold provenance — one click away</span>
            <Link to="/thresholds" className="mono" style={{ fontSize: 12 }}>
              all profiles →
            </Link>
          </div>
          {matched.length === 0 ? (
            <div style={{ color: "var(--text-3)", fontSize: 13 }}>
              No enabled profiles for {paramLabel(param)} at {locationLabel(sensor?.locationType)}.
            </div>
          ) : (
            <dl>
              {matched.slice(0, 3).map((p) => (
                <div className="kv" key={`${p.profileKey}-v${p.version}`}>
                  <dt>Profile</dt>
                  <dd>{p.profileKey} · v{p.version}</dd>
                  <dt>Limits</dt>
                  <dd>
                    {p.warning != null ? `warn ${p.warning}` : "—"} /{" "}
                    {p.critical != null ? `crit ${p.critical}` : "—"} {p.unit} ({p.comparator})
                  </dd>
                  <dt>Source</dt>
                  <dd style={{ fontFamily: "var(--sans)", fontSize: 12.5 }}>
                    {p.sourceRef || "—"}
                    {p.sourceDate ? ` · ${fmtDateIST(p.sourceDate)}` : ""}
                  </dd>
                  <dt>Verification</dt>
                  <dd style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--warn)" }}>
                    {p.verificationNote || "verified via secondary source — cross-check pending"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* active alerts */}
        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Active alerts at this station</span>
            <Link to="/alerts" className="mono" style={{ fontSize: 12 }}>
              alert desk →
            </Link>
          </div>
          {(detail?.activeAlerts || []).length === 0 ? (
            <div style={{ color: "var(--text-3)", fontSize: 13 }}>
              Nothing open at {id} right now.
            </div>
          ) : (
            <div className="table-wrap" style={{ border: "none" }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Parameter</th>
                    <th className="num">Trigger</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.activeAlerts || []).map((a) => (
                    <tr key={a.alertId}>
                      <td><StatusPill status={a.severity} /></td>
                      <td className="mono">{paramLabel(a.parameter)}</td>
                      <td className="num mono">
                        {a.triggerValue != null ? fmtNum(a.triggerValue, 3) : "—"}
                        <span style={{ color: "var(--text-3)", fontSize: 11 }}> {paramUnit(a.parameter)}</span>
                      </td>
                      <td><StatusPill status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Notice kind="" title="Units">
        Every value on this page carries its unit, per the canonical unit table: airflow m³/min,
        velocity m/s, CH₄/CO₂/O₂ %vol, CO ppm, temperatures °C, RH %, pressure Pa, dust mg/m³, fan
        speed rpm. Times are IST.
      </Notice>
    </>
  );
}

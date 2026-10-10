import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { History, Sensors } from "../lib/api";
import { useToast } from "../ui/toast";
import { CHART, ChartTooltip, LoadingPanel, Notice, PageHeader, StatePanel } from "../ui/primitives";
import { fmtDateTimeIST, fmtNum, fmtTimeIST, paramLabel, paramUnit, sortParams } from "../lib/format";
import { IconInfo } from "../ui/icons";
import DatasetAnalysis from "./DatasetAnalysis";

const RANGES = ["1h", "6h", "24h", "7d"];
const SERIES_COLORS = ["#8a5a24", "#b0763a", "#5f7a3d", "#b3372a", "#7a6c4f"];

function pearson(xs, ys) {
  const pairs = xs
    .map((x, i) => [x, ys[i]])
    .filter(([x, y]) => x != null && y != null);
  const n = pairs.length;
  if (n < 3) return { r: null, n };
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  pairs.forEach(([x, y]) => {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    syy += (y - my) * (y - my);
  });
  const den = Math.sqrt(sxx * syy);
  return { r: den > 0 ? sxy / den : null, n };
}

function scatterBuckets(raw, xParam, yParam) {
  if (!raw || !raw.length) return [];
  return raw
    .map((b) => {
      const vals = b.data || b.values || {};
      let x = null, y = null;
      Object.keys(vals).forEach((k) => {
        const v = vals[k] || {};
        if (v[xParam] != null) x = v[xParam];
        if (v[yParam] != null) y = v[yParam];
      });
      return x != null && y != null ? { x, y } : null;
    })
    .filter(Boolean);
}

const PARAM_UNIVERSE = ["ch4Pct", "co2Pct", "coPpm", "o2Pct", "tempC", "wetBulbC", "rhPct", "airflowM3min", "velocityMs", "pressurePa"];

/* UI display names → backend Reading VALUE_PARAMS. */
const PARAM_TO_API = {
  ch4Pct: "ch4",
  co2Pct: "co2",
  coPpm: "co",
  o2Pct: "o2",
  tempC: "temp",
  wetBulbC: "wetBulb",
  rhPct: "humidity",
  airflowM3min: "airflow",
  velocityMs: "velocity",
  pressurePa: "pressure",
};
const toApiParam = (p) => PARAM_TO_API[p] || p;

function CorrelationsTab() {
  const { pushApiError } = useToast();
  const [sensors, setSensors] = useState([]);
  const [sensorId, setSensorId] = useState("");
  const [params, setParams] = useState([]);
  const [xParam, setXParam] = useState("ch4Pct");
  const [yParam, setYParam] = useState("airflowM3min");
  const [range, setRange] = useState("24h");
  const [points, setPoints] = useState([]);
  const [stat, setStat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Sensors.list()
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.sensors || d?.data || [];
        setSensors(list);
        const first = list[0];
        const sid = first?.sensorId || first?.id;
        setSensorId(sid || "");
        setParams(sortParams(first?.parameters || []));
        setLoading(false);
      })
      .catch((e) => {
        setError(e);
        setLoading(false);
      });
  }, []);

  const load = useCallback(async () => {
    if (!sensorId || !xParam || !yParam) return;
    setLoading(true);
    try {
      const xp = toApiParam(xParam), yp = toApiParam(yParam);
      const d = await History.multi({
        sensorIds: [sensorId],
        params: [xp, yp],
        range,
        buckets: 400,
      });
      const rows = Array.isArray(d) ? d : d?.buckets || d?.data || [];
      const pts = scatterBuckets(rows, xp, yp);
      setPoints(pts);
      const { r, n } = pearson(pts.map((p) => p.x), pts.map((p) => p.y));
      setStat({ r, n });
      setError(null);
    } catch (e) {
      setError(e);
      pushApiError(e, "Could not load correlation data.");
    } finally {
      setLoading(false);
    }
  }, [sensorId, xParam, yParam, range, pushApiError]);

  useEffect(() => {
    if (sensorId) load();
  }, [load, sensorId]);

  const allParams = useMemo(() => {
    const set = new Set(params);
    PARAM_UNIVERSE.forEach((p) => set.add(p));
    return sortParams([...set]);
  }, [params]);

  const rNote = stat && stat.r != null
    ? `r = ${fmtNum(stat.r, 3)} over ${stat.n} aligned buckets`
    : stat ? `insufficient aligned data (${stat.n} buckets)` : "";

  if (loading && !points.length) return <LoadingPanel />;
  if (error && !points.length) {
    return (
      <StatePanel title="Correlations unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={26} />}>
        {error.message}
      </StatePanel>
    );
  }

  return (
    <div>
      <div className="map-toolbar">
        <select value={sensorId} onChange={(e) => setSensorId(e.target.value)} aria-label="Sensor">
          {sensors.map((s) => (
            <option key={s.sensorId || s.id} value={s.sensorId || s.id}>
              {(s.sensorId || s.id)} — {s.name}
            </option>
          ))}
        </select>
        <select value={xParam} onChange={(e) => setXParam(e.target.value)} aria-label="X parameter">
          {allParams.map((p) => <option key={p} value={p}>X: {paramLabel(p)}</option>)}
        </select>
        <select value={yParam} onChange={(e) => setYParam(e.target.value)} aria-label="Y parameter">
          {allParams.map((p) => <option key={p} value={p}>Y: {paramLabel(p)}</option>)}
        </select>
        <div className="chip-row">
          {RANGES.map((r) => (
            <button key={r} className={`chip${range === r ? " active" : ""}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="card-head">
          <span className="eyebrow">
            {paramLabel(xParam)} vs {paramLabel(yParam)} — {sensorId}
          </span>
          <span className="mono" style={{ fontSize: 12 }}>{rNote}</span>
        </div>
        {points.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 13, padding: "20px 0" }}>
            No aligned samples for this pair in {range}. Try a longer range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 12, right: 28, bottom: 16, left: 8 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name={paramLabel(xParam)}
                unit={paramUnit(xParam)}
                tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                label={{ value: `${paramLabel(xParam)} (${paramUnit(xParam)})`, position: "insideBottom", offset: -4, fill: CHART.tick, fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={paramLabel(yParam)}
                unit={paramUnit(yParam)}
                tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                width={72}
                label={{ value: `${paramLabel(yParam)} (${paramUnit(yParam)})`, angle: -90, position: "insideLeft", fill: CHART.tick, fontSize: 11 }}
              />
              <ZAxis type="number" range={[28, 28]} />
              <Tooltip content={<ChartTooltip labelFmt={(t) => fmtDateTimeIST(t)} />} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter name={`${paramLabel(xParam)} vs ${paramLabel(yParam)}`} data={points} fill="#8a5a24" fillOpacity={0.55} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <div className="chart-legend-note">
          Pearson r is computed over time-aligned buckets. A strong negative r between CH₄ and
          airflow is what good ventilation looks like — dilution at work.
        </div>
      </div>
    </div>
  );
}

function MultiTrendTab() {
  const { pushApiError } = useToast();
  const [sensors, setSensors] = useState([]);
  const [picked, setPicked] = useState([]);
  const [param, setParam] = useState("ch4Pct");
  const [range, setRange] = useState("24h");
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Sensors.list()
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.sensors || d?.data || [];
        setSensors(list);
        // Default to stations that actually measure the selected parameter.
        const ap = toApiParam(param);
        const measuring = list.filter((s) => (s.parameters || []).includes(ap));
        const fallback = (measuring.length ? measuring : list).slice(0, 3);
        setPicked(fallback.map((s) => s.sensorId || s.id));
        setLoading(false);
      })
      .catch((e) => {
        setError(e);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (sid) =>
    setPicked((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid].slice(0, 5)));

  const load = useCallback(async () => {
    if (!picked.length) {
      setSeries([]);
      return;
    }
    setLoading(true);
    try {
      const ap = toApiParam(param);
      const d = await History.multi({ sensorIds: picked, params: [ap], range, buckets: 300 });
      const rows = Array.isArray(d) ? d : d?.buckets || d?.data || [];
      const merged = new Map();
      rows.forEach((b) => {
        const entry = { t: b.t };
        const vals = b.data || b.values || {};
        Object.keys(vals).forEach((sid) => {
          const v = vals[sid];
          entry[sid] = v && typeof v === "object" ? v[ap] ?? null : v;
        });
        merged.set(b.t, entry);
      });
      setSeries([...merged.values()].sort((a, b) => new Date(a.t) - new Date(b.t)));
      setError(null);
    } catch (e) {
      setError(e);
      pushApiError(e, "Could not load multi-sensor trend.");
    } finally {
      setLoading(false);
    }
  }, [picked, param, range, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  const paramOptions = useMemo(() => {
    const set = new Set();
    sensors.forEach((s) => (s.parameters || []).forEach((p) => set.add(p)));
    PARAM_UNIVERSE.forEach((p) => set.add(p));
    return sortParams([...set]);
  }, [sensors]);

  return (
    <div>
      <div className="map-toolbar" style={{ flexWrap: "wrap" }}>
        <select
          value={param}
          onChange={(e) => {
            const np = e.target.value;
            setParam(np);
            // Keep the station selection meaningful: if none of the picked
            // stations measures the new parameter, auto-pick ones that do.
            const ap = toApiParam(np);
            setPicked((prev) => {
              const byId = new Map(sensors.map((s) => [s.sensorId || s.id, s]));
              const ok = prev.filter((sid) => ((byId.get(sid) || {}).parameters || []).includes(ap));
              if (ok.length) return prev;
              const measuring = sensors.filter((s) => (s.parameters || []).includes(ap));
              return (measuring.length ? measuring : sensors).slice(0, 3).map((s) => s.sensorId || s.id);
            });
          }}
          aria-label="Parameter"
        >
          {paramOptions.map((p) => <option key={p} value={p}>{paramLabel(p)}</option>)}
        </select>
        <div className="chip-row">
          {RANGES.map((r) => (
            <button key={r} className={`chip${range === r ? " active" : ""}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="chip-row" style={{ marginBottom: 14 }}>
        {sensors.map((s) => {
          const sid = s.sensorId || s.id;
          return (
            <button
              key={sid}
              className={`chip${picked.includes(sid) ? " active-amber" : ""}`}
              onClick={() => toggle(sid)}
            >
              {sid}
            </button>
          );
        })}
      </div>

      <div className="chart-card">
        <div className="card-head">
          <span className="eyebrow">
            {paramLabel(param)} across stations — up to 5, gaps shown as breaks
          </span>
        </div>
        {error ? (
          <StatePanel title="Trend unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={26} />}>
            {error.message}
          </StatePanel>
        ) : loading && !series.length ? (
          <LoadingPanel label="Loading trend…" />
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={series} margin={{ top: 12, right: 28, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => fmtTimeIST(t)}
                tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                minTickGap={48}
              />
              <YAxis
                tick={{ fill: CHART.tick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                width={64}
                label={{ value: paramUnit(param), angle: -90, position: "insideLeft", fill: CHART.tick, fontSize: 11 }}
              />
              <Tooltip content={<ChartTooltip labelFmt={(t) => fmtDateTimeIST(t)} />} cursor={{ stroke: "#c9bda2" }} />
              {picked.map((sid, i) => (
                <Line
                  key={sid}
                  type="monotone"
                  dataKey={sid}
                  name={sid}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: "trends", label: "Multi-sensor trends" },
  { id: "correlations", label: "Correlations" },
  { id: "dataset", label: "Dataset analysis" },
];

export default function AnalyticsPage() {
  const [tab, setTab] = useState("trends");
  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        scriptWord="Analytics"
        title=""
        lede="Multi-station trends, cross-parameter correlations, and the full uploaded-dataset workbench."
      />

      <div className="chip-row" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`chip${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trends" ? <MultiTrendTab /> : null}
      {tab === "correlations" ? <CorrelationsTab /> : null}
      {tab === "dataset" ? (
        <>
          <Notice kind="" title="Uploaded datasets">
            The v1 dataset workbench is preserved here unchanged — upload a CSV and analyse it the
            same way as before.
          </Notice>
          <DatasetAnalysis />
        </>
      ) : null}
    </>
  );
}

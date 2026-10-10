import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRealtime } from "../realtime/RealtimeContext";
import { useInspector } from "../ui/InspectorContext";
import { useToast } from "../ui/toast";
import { Branches, Doors, Fans, Regulators, Sensors as SensorsApi, Simulator, Thresholds as ThresholdsApi } from "../lib/api";
import { LoadingPanel, Notice, PageHeader, StatePanel } from "../ui/primitives";
import { StatusPill } from "../ui/primitives";
import { fmtDateTimeIST, fmtNum, paramLabel, paramUnit } from "../lib/format";
import { IconFit, IconInfo, IconLayers } from "../ui/icons";
import TimeMachine from "../ui/TimeMachine";

/* ============================================================
   INTERACTIVE SVG MINE MAP — viewBox 0 0 1000 600 (per seed).
   Data-first: renders backend branch paths + sensor mapPositions;
   falls back to the seeded schematic when the API omits geometry.
   ============================================================ */

const VB = { w: 1000, h: 600 };

const FALLBACK_BRANCHES = [
  { branchId: "B-INTAKE", name: "Main Intake Airway", direction: "INTAKE", area: 12, path: [{ x: 80, y: 140 }, { x: 240, y: 140 }] },
  { branchId: "B-01", name: "Intake to District", direction: "INTAKE", area: 10, path: [{ x: 240, y: 140 }, { x: 420, y: 140 }] },
  { branchId: "B-LVC", name: "Last Ventilation Connection", direction: "INTAKE", area: 8, path: [{ x: 420, y: 140 }, { x: 600, y: 140 }] },
  { branchId: "B-DWORK", name: "District Working Airway", direction: "RETURN", area: 8, path: [{ x: 600, y: 140 }, { x: 780, y: 140 }] },
  { branchId: "B-DRET", name: "District Return Airway", direction: "RETURN", area: 10, path: [{ x: 780, y: 140 }, { x: 920, y: 140 }] },
  { branchId: "B-MAINRET", name: "Main Return Airway", direction: "RETURN", area: 10, path: [{ x: 920, y: 140 }, { x: 960, y: 140 }] },
  { branchId: "B-FANDRIFT", name: "Fan Drift", direction: "RETURN", area: 6, path: [{ x: 780, y: 140 }, { x: 780, y: 340 }] },
];

const JUNCTIONS = [
  { label: "J1", x: 240, y: 140 },
  { label: "J2", x: 420, y: 140 },
  { label: "District split", x: 600, y: 140 },
  { label: "Return junction", x: 780, y: 140 },
  { label: "Main return junction", x: 920, y: 140 },
];

const LAYERS = ["AIRFLOW", "PRESSURE", "CH4", "CO", "CO2", "O2", "TEMPERATURE", "HUMIDITY"];
const LAYER_PARAM = { CH4: "ch4", CO: "co", CO2: "co2", O2: "o2", TEMPERATURE: "temp", HUMIDITY: "humidity" };

const LEVELS = [
  { id: "L-1", label: "L-1", elev: "−120 m" },
  { id: "L-2", label: "L-2", elev: "−240 m" },
  { id: "L-3", label: "L-3", elev: "−360 m" },
  { id: "L-4", label: "L-4", elev: "−480 m" },
];

/* restrained industrial ramps: [low, mid, high] — no rainbow */
const RAMPS = {
  CH4: ["#ddd2b4", "#b97e14", "#b3372a"],
  CO: ["#ddd2b4", "#c06a1f", "#b3372a"],
  CO2: ["#ddd2b4", "#8a6d3b", "#6e5320"],
  O2: ["#b3372a", "#b97e14", "#5f7a3d"], // low O2 is bad → red at low end
  TEMPERATURE: ["#ddd2b4", "#b97e14", "#b3372a"],
  HUMIDITY: ["#ddd2b4", "#7d8a96", "#4e5a66"],
  PRESSURE: ["#ddd2b4", "#b0763a", "#b3372a"],
};

function hexLerp(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const pc = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${pc.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function rampColor(stops, t) {
  const c = Math.max(0, Math.min(1, t));
  if (c <= 0.5) return hexLerp(stops[0], stops[1], c * 2);
  return hexLerp(stops[1], stops[2], (c - 0.5) * 2);
}

/* polyline helpers */
function pathPoints(branch) {
  const p = branch.path && branch.path.length >= 2 ? branch.path : null;
  if (p) return p;
  if (branch.fromNode && branch.toNode) return [{ x: branch.fromNode.x, y: branch.fromNode.y }, { x: branch.toNode.x, y: branch.toNode.y }];
  const fb = FALLBACK_BRANCHES.find((b) => b.branchId === branch.branchId);
  return fb ? fb.path : [{ x: 0, y: 0 }, { x: 0, y: 0 }];
}
function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}
function pointAt(pts, t) {
  const L = polyLen(pts);
  let d = Math.max(0, Math.min(1, t)) * L;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (d <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : d / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
      };
    }
    d -= seg;
  }
  return pts[pts.length - 1];
}

/* ---------------- glyphs ---------------- */

function SensorMarker({ s, status, onSelect, onHover, dimmed }) {
  const pos = s.mapPosition || { x: 0, y: 0 };
  const ring = { NORMAL: "#5f7a3d", WARNING: "#b97e14", CRITICAL: "#b3372a", STALE: "#7d8a96", OFFLINE: "#a39a88" }[String(status).toUpperCase()] || "#8a7d67";
  return (
    <g
      className="sensor-marker"
      transform={`translate(${pos.x},${pos.y - 26})`}
      onClick={(e) => { e.stopPropagation(); onSelect("sensor", s.sensorId, s); }}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY, obj: { kind: "sensor", id: s.sensorId, data: s } })}
      onMouseLeave={() => onHover(null)}
      opacity={dimmed ? 0.45 : 1}
    >
      {String(status).toUpperCase() === "CRITICAL" ? (
        <circle className="warn-blink" r="13" fill="none" stroke="#b3372a" strokeWidth="2.5" />
      ) : null}
      <circle className="marker-ring" r="9" fill="#fffdf8" stroke={ring} strokeWidth="2.4" />
      <circle r="3.2" fill={ring} />
      <text y="-15" textAnchor="middle" fontSize="11" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
        {s.sensorId}
      </text>
    </g>
  );
}

function FanGlyph({ fan, onSelect, onHover }) {
  const pos = fan.mapPosition || fan.position || (fan.kind === "aux" ? { x: 832, y: 384 } : { x: 780, y: 384 });
  const running = String(fan.status).toUpperCase() === "RUNNING";
  const cls = `fan-blades${!running ? " stopped" : (fan.rpm || 0) > (fan.ratedRpm || 1000) * 0.7 ? " fast" : (fan.rpm || 0) < (fan.ratedRpm || 1000) * 0.3 ? " slow" : ""}`;
  return (
    <g
      transform={`translate(${pos.x},${pos.y})`}
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onSelect("fan", fan.fanId, fan); }}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY, obj: { kind: "fan", id: fan.fanId, data: fan } })}
      onMouseLeave={() => onHover(null)}
    >
      <rect x="-24" y="-24" width="48" height="48" fill="#f1ebdd" stroke="#8a5a24" strokeWidth="1.6" />
      <circle r="17" fill="none" stroke="#8a5a24" strokeWidth="1.6" />
      <g className={cls} stroke={running ? "#8a5a24" : "#a39a88"} strokeWidth="2.4" strokeLinecap="round">
        <path d="M0 0c-8-3-13-10-10-17 3-7 13-5 15 3" />
        <path d="M0 0c8 3 13 10 10 17-3 7-13 5-15-3" />
        <path d="M0 0c-3-8-10-13-17-10-7 3-5 13 3 15" />
        <path d="M0 0c3 8 10 13 17 10 7-3 5-13-3-15" />
      </g>
      <circle r="3" fill="#211c15" />
      <text y="38" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
        {fan.fanId}
      </text>
      <text y="50" textAnchor="middle" fontSize="9" fill="#8a7d67" fontFamily="JetBrains Mono, monospace">
        {running ? `${fmtNum(fan.rpm, 0)} rpm` : String(fan.status || "—").toUpperCase()}
      </text>
    </g>
  );
}

function DoorGlyph({ door, branch, onSelect, onHover }) {
  const pts = pathPoints(branch || {});
  const p = pointAt(pts, 0.42);
  const open = String(door.status).toUpperCase() === "OPEN";
  return (
    <g
      transform={`translate(${p.x},${p.y})`}
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onSelect("door", door.doorId, door); }}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY, obj: { kind: "door", id: door.doorId, data: door } })}
      onMouseLeave={() => onHover(null)}
    >
      <rect x="-11" y="-11" width="22" height="22" fill={open ? "#edf0e2" : "#f8efdc"} stroke={open ? "#5f7a3d" : "#b97e14"} strokeWidth="1.8" />
      <path d={open ? "M-6 -6 L6 -6 M-6 -6 L-6 6" : "M-6 -6 L6 6 M6 -6 L-6 6"} stroke="#211c15" strokeWidth="1.8" />
      <text y="-16" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
        {door.doorId}
      </text>
    </g>
  );
}

function RegulatorGlyph({ reg, branch, onSelect, onHover }) {
  const pts = pathPoints(branch || {});
  const p = pointAt(pts, 0.62);
  const open = Number(reg.openingPct ?? 0);
  return (
    <g
      transform={`translate(${p.x},${p.y})`}
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onSelect("regulator", reg.regulatorId, reg); }}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY, obj: { kind: "regulator", id: reg.regulatorId, data: reg } })}
      onMouseLeave={() => onHover(null)}
    >
      <rect x="-12" y="-9" width="24" height="18" fill="#fffdf8" stroke="#4e5a66" strokeWidth="1.8" />
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={-9 + i * 6}
          y1={-6}
          x2={-9 + i * 6}
          y2={-6 + 12 * (open / 100)}
          stroke="#4e5a66"
          strokeWidth="2.2"
        />
      ))}
      <text y="-14" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
        {reg.regulatorId}
      </text>
    </g>
  );
}

/* ---------------- main page ---------------- */

export default function NetworkPage() {
  const location = useLocation();
  const { readings, statuses, sim } = useRealtime();
  const { select } = useInspector();
  const { pushApiError } = useToast();

  const [branches, setBranches] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [fans, setFans] = useState([]);
  const [doors, setDoors] = useState([]);
  const [regs, setRegs] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [layer, setLayer] = useState(location.state?.layer || "AIRFLOW");

  /* keyboard shortcuts navigate here with a layer in location.state */
  useEffect(() => {
    if (location.state?.layer && LAYERS.includes(location.state.layer)) {
      setLayer(location.state.layer);
    }
  }, [location.state]);
  const [level, setLevel] = useState("L-1");
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState(null);
  const [atIso, setAtIso] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const particleRefs = useRef([]);

  const isHist = !!atIso;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s, f, d, r, t] = await Promise.allSettled([
        Branches.list(),
        SensorsApi.list(),
        Fans.list(),
        Doors.list(),
        Regulators.list(),
        ThresholdsApi.list(),
      ]);
      const un = (res, key) => {
        if (res.status !== "fulfilled") return [];
        const v = res.value;
        return Array.isArray(v) ? v : v?.[key] || v?.data || [];
      };
      setBranches(un(b, "branches"));
      setSensors(un(s, "sensors"));
      setFans(un(f, "fans"));
      setDoors(un(d, "doors"));
      setRegs(un(r, "regulators"));
      setThresholds(un(t, "thresholds"));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
      pushApiError(e, "Could not load the network.");
    } finally {
      setLoading(false);
    }
  }, [pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  /* historical snapshot payload */
  useEffect(() => {
    if (!atIso) {
      setSnapshot(null);
      return;
    }
    (async () => {
      try {
        const d = await Simulator.snapshotAt(atIso);
        setSnapshot(d?.snapshot || d || null);
      } catch (e) {
        pushApiError(e, "Snapshot unavailable — showing live geometry with last known values.");
        setSnapshot(null);
      }
    })();
  }, [atIso]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- merged live model ---- */
  const branchById = useMemo(() => {
    const m = new Map();
    const live = isHist ? snapshot?.branches || {} : sim.branches || {};
    const list = branches.length ? branches : FALLBACK_BRANCHES;
    list.forEach((b) => {
      const lv = live[b.branchId] || b.live || {};
      m.set(b.branchId, {
        ...b,
        q: lv.q ?? lv.airflowM3min ?? null,
        v: lv.v ?? lv.velocityMs ?? null,
        dp: lv.dp ?? lv.pressureDropPa ?? null,
        status: lv.status || b.status || "NORMAL",
      });
    });
    return m;
  }, [branches, sim.branches, snapshot, isHist]);

  const sensorLive = useMemo(() => {
    const m = new Map();
    sensors.forEach((s) => {
      const live = isHist
        ? snapshot?.sensors?.[s.sensorId]
        : readings[s.sensorId];
      m.set(s.sensorId, {
        ...s,
        values: live?.values || s.values || s.lastReading?.values || null,
        status: isHist ? live?.status || s.status : statuses[s.sensorId]?.status || s.status || "NORMAL",
      });
    });
    return m;
  }, [sensors, readings, statuses, snapshot, isHist]);

  /* sensor readings grouped by branch for gas layers */
  const branchReadings = useMemo(() => {
    const m = new Map();
    sensorLive.forEach((s) => {
      if (!s.branchId || !s.values) return;
      if (!m.has(s.branchId)) m.set(s.branchId, {});
      Object.assign(m.get(s.branchId), s.values);
    });
    return m;
  }, [sensorLive]);

  const limitOf = useCallback(
    (param) => {
      const cands = thresholds.filter(
        (t) => t.parameter === param && t.enabled !== false && t.warning != null
      );
      if (!cands.length) return null;
      cands.sort((a, b) => (b.version || 0) - (a.version || 0));
      const t = cands[0];
      return { warn: t.warning, crit: t.critical ?? t.warning * 1.25, src: t.sourceRef };
    },
    [thresholds]
  );

  /* ---- branch edge styling per layer ---- */
  const edgeStyle = useCallback(
    (b) => {
      const id = b.branchId;
      if (layer === "AIRFLOW" || layer === "NONE") {
        const st = String(b.status).toUpperCase();
        if (st === "CRITICAL" || st === "FAULT") return { color: "#b3372a", blink: true };
        if (st === "WARNING" || st === "DEGRADED") return { color: "#b97e14", blink: false };
        return { color: "#6e6552", blink: false };
      }
      if (layer === "PRESSURE") {
        const dp = b.dp;
        if (dp == null) return { color: "#6e6552", blink: false };
        return { color: rampColor(RAMPS.PRESSURE, Math.min(1, dp / 600)), blink: dp > 450 };
      }
      const param = LAYER_PARAM[layer];
      const vals = branchReadings.get(id);
      const v = vals?.[param];
      if (v == null) return { color: "#6e6552", blink: false };
      const lim = limitOf(param);
      let t;
      if (lim) {
        if (param === "o2") {
          // low O2 is bad — invert
          t = v >= lim.warn ? 1 : v <= lim.crit ? 0 : 0.5 + 0.5 * ((v - lim.crit) / (lim.warn - lim.crit));
        } else {
          t = v < lim.warn ? (v / lim.warn) * 0.5 : 0.5 + Math.min(1, (v - lim.warn) / Math.max(1e-9, lim.crit - lim.warn)) * 0.5;
        }
      } else {
        t = 0.25;
      }
      const bad = lim ? (param === "o2" ? v <= lim.crit : v >= lim.crit) : false;
      return { color: rampColor(RAMPS[layer] || RAMPS.CH4, Math.max(0, Math.min(1, t))), blink: bad };
    },
    [layer, branchReadings, limitOf]
  );

  /* ---- particles (airflow animation) ---- */
  const particles = useMemo(() => {
    const out = [];
    branchById.forEach((b) => {
      const pts = pathPoints(b);
      const L = polyLen(pts);
      if (L < 10) return;
      const v = Number(b.v) || 0;
      const n = Math.max(3, Math.min(9, Math.round(3 + v * 2.2)));
      for (let i = 0; i < n; i++) {
        out.push({ branchId: b.branchId, pts, len: L, off: i / n, speed: 26 + v * 22 });
      }
    });
    return out;
  }, [branchById]);

  useEffect(() => {
    particleRefs.current = particleRefs.current.slice(0, particles.length);
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      particles.forEach((p, i) => {
        const el = particleRefs.current[i];
        if (!el) return;
        p.off = (p.off + (p.speed * dt) / p.len) % 1;
        const pt = pointAt(p.pts, p.off);
        el.setAttribute("cx", pt.x);
        el.setAttribute("cy", pt.y);
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [particles]);

  /* ---- zoom / pan ---- */
  const onWheel = (e) => {
    e.preventDefault();
    const rect = frameRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scale = Math.exp(-e.deltaY * 0.0012);
    setView((v) => {
      const k = Math.max(0.5, Math.min(4, v.k * scale));
      const s = k / v.k;
      return { k, x: mx - (mx - v.x) * s, y: my - (my - v.y) * s };
    });
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      frameRef.current?.classList.add("dragging");
    }
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const endDrag = () => {
    dragRef.current = null;
    frameRef.current?.classList.remove("dragging");
  };
  const fit = () => setView({ x: 0, y: 0, k: 1 });

  /* app-level "F" shortcut dispatches map:fit */
  useEffect(() => {
    const handler = () => fit();
    window.addEventListener("map:fit", handler);
    return () => window.removeEventListener("map:fit", handler);
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSelect = useCallback(
    (kind, id, data) => select(kind, id, data),
    [select]
  );

  const tooltip = (obj) => {
    if (!obj) return null;
    const { kind, id, data } = obj;
    const rows = [];
    if (kind === "sensor") {
      const s = sensorLive.get(id) || data;
      rows.push(["Status", s?.status || "—"]);
      if (s?.values?.ch4 != null) rows.push(["CH₄", `${fmtNum(s.values.ch4, 3)} %vol`]);
      if (s?.values?.airflow != null) rows.push(["Airflow", `${fmtNum(s.values.airflow, 1)} m³/min`]);
      rows.push(["Action", "click → inspect"]);
    } else if (kind === "branch") {
      const b = branchById.get(id);
      rows.push(["Airflow", `${fmtNum(b?.q, 1)} m³/min`]);
      rows.push(["Velocity", `${fmtNum(b?.v, 2)} m/s`]);
      rows.push(["Status", b?.status || "—"]);
      rows.push(["Action", "click → inspect"]);
    } else if (kind === "fan") {
      rows.push(["Status", data?.status || "—"]);
      rows.push(["Speed", `${fmtNum(data?.rpm, 0)} rpm`]);
      rows.push(["Action", "click → control"]);
    } else if (kind === "door") {
      rows.push(["Status", data?.status || "—"]);
      rows.push(["Action", "click → open/close"]);
    } else if (kind === "regulator") {
      rows.push(["Opening", `${fmtNum(data?.openingPct, 0)} %`]);
      rows.push(["Action", "click → adjust"]);
    }
    return { title: data?.name || id, id, rows };
  };
  const tt = tooltip(hover?.obj);

  const levelMeta = LEVELS.find((l) => l.id === level);

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Mine plan" scriptWord="Ventilation" title="network" />
        <LoadingPanel label="Loading network geometry…" />
      </>
    );
  }

  if (loadError && !branches.length && !sensors.length) {
    return (
      <>
        <PageHeader eyebrow="Mine plan" scriptWord="Ventilation" title="network" />
        <StatePanel title="Network unavailable" requestId={loadError.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {loadError.message}
        </StatePanel>
      </>
    );
  }

  const branchList = [...branchById.values()];

  return (
    <>
      <PageHeader
        eyebrow="Mine plan · interactive"
        scriptWord="Ventilation"
        title="network"
        lede="Live schematic of the Demo Underground Mine airway network. Particle speed follows branch velocity; edge colour follows the active layer. Click any object to inspect and control it."
        right={
          <span className={`live-tag${isHist ? " paused" : ""}`}>
            <span className="dot" /> {isHist ? "historical" : "live"}
          </span>
        }
      />

      <div className="map-toolbar">
        <div className="level-rail" role="group" aria-label="Level selector">
          <span className="lbl">Level</span>
          {LEVELS.map((l) => (
            <button key={l.id} className={`chip${level === l.id ? " active" : ""}`} onClick={() => setLevel(l.id)}>
              {l.label}
            </button>
          ))}
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{levelMeta?.elev}</span>
        </div>
        <div className="chip-row" role="group" aria-label="Map layers">
          <span className="lbl mono" style={{ fontSize: 9.5, letterSpacing: "0.16em", color: "var(--text-3)", alignSelf: "center" }}>
            <IconLayers size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />LAYER
          </span>
          {LAYERS.map((l) => (
            <button key={l} className={`chip${layer === l ? " active-amber" : ""}`} onClick={() => setLayer(l)} title={`Shortcut ${LAYERS.indexOf(l) + 1}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={fit} title="Fit map (F)">
          <IconFit size={13} /> Fit
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
          Reset view
        </button>
      </div>

      <div
        className="map-frame"
        ref={frameRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={() => { endDrag(); setHover(null); }}
      >
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} role="img" aria-label="Mine ventilation network schematic">
          {/* strata background — cross-section feel, selected level band highlighted */}
          <g>
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={-2000}
                y={i * 150}
                width={5000}
                height={150}
                fill={LEVELS[i].id === level ? "#e7dcc0" : i % 2 ? "#efe8d6" : "#f2ecdc"}
              />
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={i} x1={-2000} y1={i * 150} x2={5000} y2={i * 150} stroke="#c9bda2" strokeWidth="1" strokeDasharray="8 6" />
            ))}
            <g fontFamily="JetBrains Mono, monospace" fontSize="13" fill="#8a7d67">
              {LEVELS.map((l, i) => (
                <text key={l.id} x={-1990} y={i * 150 + 24} fontWeight={l.id === level ? 700 : 400} fill={l.id === level ? "#8a5a24" : "#8a7d67"}>
                  {l.label} · {l.elev}
                </text>
              ))}
            </g>
          </g>

          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {/* surface strip */}
            <rect x={-2000} y={-400} width={5000} height={430} fill="#f6f1e3" />
            <line x1={-2000} y1={30} x2={5000} y2={30} stroke="#8a5a24" strokeWidth="2" />
            <text x={-1990} y={14} fontFamily="JetBrains Mono, monospace" fontSize="12" letterSpacing="3" fill="#8a7d67">
              SURFACE
            </text>

            {/* shaft */}
            <g>
              <rect x="52" y="30" width="56" height="110" fill="#e9e1cf" stroke="#8a5a24" strokeWidth="2" />
              {[50, 70, 90, 110].map((y) => (
                <line key={y} x1="52" y1={y} x2="108" y2={y} stroke="#8a5a24" strokeWidth="1" />
              ))}
              <text x="80" y="162" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
                SHAFT
              </text>
            </g>

            {/* intake portal */}
            <g>
              <rect x="120" y="108" width="60" height="64" fill="#e9e1cf" stroke="#8a5a24" strokeWidth="2" />
              <path d="M120 108l12-16h36l12 16" fill="none" stroke="#8a5a24" strokeWidth="2" />
              <text x="150" y="196" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
                INTAKE PORTAL
              </text>
            </g>

            {/* branches */}
            {branchList.map((b) => {
              const pts = pathPoints(b);
              const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
              const st = edgeStyle(b);
              const w = Math.max(5, Math.min(14, (b.area || 10) * 1.1));
              return (
                <g key={b.branchId}>
                  <path d={d} fill="none" stroke="#fffdf8" strokeWidth={w + 4} strokeLinecap="round" opacity="0.85" />
                  <path
                    d={d}
                    fill="none"
                    stroke={st.color}
                    strokeWidth={w}
                    strokeLinecap="round"
                    className={st.blink ? "warn-blink" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={() => doSelect("branch", b.branchId, b)}
                    onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, obj: { kind: "branch", id: b.branchId, data: b } })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {st.blink ? <title>{b.name} — {b.status}</title> : null}
                  </path>
                  {/* airflow direction overlay */}
                  <path d={d} fill="none" stroke="#211c15" strokeWidth="1.4" className="branch-flow" opacity="0.35" />
                  {/* label */}
                  {(() => {
                    const mid = pointAt(pts, 0.5);
                    return (
                      <text
                        x={mid.x}
                        y={mid.y + w / 2 + 16}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#5c5344"
                        fontFamily="JetBrains Mono, monospace"
                        pointerEvents="none"
                      >
                        {b.branchId} · {fmtNum(b.q, 0)} m³/min
                      </text>
                    );
                  })()}
                </g>
              );
            })}

            {/* particles */}
            <g pointerEvents="none">
              {particles.map((p, i) => (
                <circle
                  key={i}
                  ref={(el) => { particleRefs.current[i] = el; }}
                  r="2.6"
                  fill="#211c15"
                  opacity="0.55"
                  cx={p.pts[0].x}
                  cy={p.pts[0].y}
                />
              ))}
            </g>

            {/* junctions */}
            {JUNCTIONS.map((j) => (
              <g key={j.label}>
                <circle cx={j.x} cy={j.y} r="6" fill="#fffdf8" stroke="#211c15" strokeWidth="1.8" />
                <text x={j.x} y={j.y - 12} textAnchor="middle" fontSize="9.5" fill="#5c5344" fontFamily="JetBrains Mono, monospace">
                  {j.label}
                </text>
              </g>
            ))}

            {/* working faces */}
            {[{ x: 636, y: 96, t: "FACE W-1" }, { x: 744, y: 96, t: "FACE W-2" }].map((f) => (
              <g key={f.t}>
                <rect x={f.x - 26} y={f.y - 12} width="52" height="24" fill="#ddd2b4" stroke="#8a5a24" strokeWidth="1.6" />
                {[0, 1, 2].map((i) => (
                  <line key={i} x1={f.x - 20 + i * 14} y1={f.y - 12} x2={f.x - 26 + i * 14} y2={f.y + 12} stroke="#8a5a24" strokeWidth="1" />
                ))}
                <text x={f.x} y={f.y - 18} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
                  {f.t}
                </text>
              </g>
            ))}

            {/* equipment near faces */}
            <g transform="translate(690,92)">
              <rect x="-14" y="-8" width="28" height="16" fill="#f1ebdd" stroke="#4e5a66" strokeWidth="1.6" />
              <circle cx="-8" cy="10" r="4" fill="none" stroke="#4e5a66" strokeWidth="1.6" />
              <circle cx="8" cy="10" r="4" fill="none" stroke="#4e5a66" strokeWidth="1.6" />
              <text y="-14" textAnchor="middle" fontSize="9" fill="#5c5344" fontFamily="JetBrains Mono, monospace">
                LHD-2
              </text>
            </g>

            {/* stoppings / seals along fan drift */}
            {[210, 250, 290].map((y) => (
              <g key={y}>
                <rect x="762" y={y} width="36" height="10" fill="#ddd2b4" stroke="#8a5a24" strokeWidth="1.4" />
                <line x1="766" y1={y} x2="774" y2={y + 10} stroke="#8a5a24" strokeWidth="1" />
                <line x1="774" y1={y} x2="782" y2={y + 10} stroke="#8a5a24" strokeWidth="1" />
                <line x1="782" y1={y} x2="790" y2={y + 10} stroke="#8a5a24" strokeWidth="1" />
              </g>
            ))}
            <text x="780" y="196" textAnchor="middle" fontSize="9.5" fill="#5c5344" fontFamily="JetBrains Mono, monospace">
              seals
            </text>

            {/* fan house */}
            <g>
              <rect x="736" y="340" width="140" height="72" fill="#e9e1cf" stroke="#8a5a24" strokeWidth="2" />
              <path d="M736 340l16-20h108l16 20" fill="none" stroke="#8a5a24" strokeWidth="2" />
              <text x="806" y="432" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#211c15" fontFamily="JetBrains Mono, monospace">
                FAN HOUSE
              </text>
            </g>

            {/* doors */}
            {doors.map((d) => {
              const b = branchById.get(d.branchId) || branchList[0];
              return <DoorGlyph key={d.doorId} door={d} branch={b} onSelect={doSelect} onHover={setHover} />;
            })}

            {/* regulators */}
            {regs.map((r) => {
              const b = branchById.get(r.branchId) || branchList[0];
              return <RegulatorGlyph key={r.regulatorId} reg={r} branch={b} onSelect={doSelect} onHover={setHover} />;
            })}

            {/* sensors */}
            {[...sensorLive.values()].map((s) => (
              <SensorMarker
                key={s.sensorId}
                s={s}
                status={s.status}
                onSelect={doSelect}
                onHover={setHover}
                dimmed={isHist}
              />
            ))}

            {/* fans */}
            {fans.map((f) => (
              <FanGlyph key={f.fanId} fan={f} onSelect={doSelect} onHover={setHover} />
            ))}
          </g>
        </svg>

        {/* hover tooltip */}
        {tt && hover ? (
          <div
            className="map-tooltip"
            style={{
              left: Math.min(hover.x - frameRef.current.getBoundingClientRect().left + 16, frameRef.current.clientWidth - 270),
              top: Math.max(hover.y - frameRef.current.getBoundingClientRect().top - 10, 8),
            }}
          >
            <div className="tt-name">{tt.title}</div>
            <div className="tt-row mono">{tt.id}</div>
            {tt.rows.map(([k, v]) => (
              <div className="tt-row" key={k}>
                {k}: <b>{v}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* layer legend */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head" style={{ marginBottom: 8 }}>
          <span className="eyebrow">Layer legend — {layer}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {layer === "AIRFLOW" && "edge colour = branch status · particle speed ∝ velocity"}
            {layer === "PRESSURE" && "edge colour = pressure drop (Pa)"}
            {LAYER_PARAM[layer] && `edge colour = ${paramLabel(LAYER_PARAM[layer])} at branch sensors`}
          </span>
        </div>
        {LAYER_PARAM[layer] || layer === "PRESSURE" ? (
          <LegendRamp stops={RAMPS[layer]} low="low" mid={layer === "PRESSURE" ? "300 Pa" : limitOf(LAYER_PARAM[layer]) ? `warn ${limitOf(LAYER_PARAM[layer]).warn}` : "mid"} high={layer === "PRESSURE" ? "600+ Pa" : limitOf(LAYER_PARAM[layer]) ? `crit ${limitOf(LAYER_PARAM[layer]).crit}` : "high"} />
        ) : (
          <div className="chip-row">
            <span className="pill neutral">neutral — normal</span>
            <span className="pill warn">amber — warning</span>
            <span className="pill crit">red blink — critical/fault</span>
          </div>
        )}
        {LAYER_PARAM[layer] && limitOf(LAYER_PARAM[layer]) ? (
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
            statutory source: {limitOf(LAYER_PARAM[layer]).src || "threshold profile"}
          </div>
        ) : null}
      </div>

      <div className="section-gap">
        <TimeMachine atIso={atIso} onSelect={setAtIso} />
        {isHist ? (
          <Notice kind="warn" title="Historical view">
            Showing the {fmtDateTimeIST(atIso)} snapshot. Live controls are disabled while time-travelling —
            press <b>LIVE</b> to return. Charts on other pages accept a matching <span className="mono">to</span> parameter.
          </Notice>
        ) : null}
      </div>

      <div className="section-gap">
        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Branch status — live</span>
            <StatusPill status={isHist ? "SIMULATED" : "NORMAL"} customLabel={isHist ? "Snapshot" : undefined} />
          </div>
          <div className="table-wrap" style={{ border: "none" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Airway</th>
                  <th>Level</th>
                  <th className="num">Airflow m³/min</th>
                  <th className="num">Velocity m/s</th>
                  <th className="num">ΔP Pa</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {branchList.map((b) => (
                  <tr key={b.branchId} className="clickable" onClick={() => doSelect("branch", b.branchId, b)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 700 }}>{b.branchId}</span>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{b.name}</div>
                    </td>
                    <td className="mono">{b.level || level}</td>
                    <td className="num mono live-value">{fmtNum(b.q, 1)}</td>
                    <td className="num mono live-value">{fmtNum(b.v, 2)}</td>
                    <td className="num mono live-value">{fmtNum(b.dp, 0)}</td>
                    <td><StatusPill status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function LegendRamp({ stops, low, mid, high }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{low}</span>
      <div
        style={{
          flex: 1,
          height: 12,
          border: "1px solid var(--border-hard)",
          background: `linear-gradient(90deg, ${stops[0]}, ${stops[1]}, ${stops[2]})`,
        }}
      />
      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{mid}</span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{high}</span>
    </div>
  );
}

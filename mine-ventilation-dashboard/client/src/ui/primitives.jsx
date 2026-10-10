import React from "react";
import { Link } from "react-router-dom";
import {
  IconCheck,
  IconCrit,
  IconInfo,
  IconOffline,
  IconStale,
  IconWarn,
} from "./icons";

/* Status → pill class + icon + label. Never colour alone. */
const STATUS_MAP = {
  NORMAL: { cls: "ok", icon: IconCheck, label: "Normal" },
  OK: { cls: "ok", icon: IconCheck, label: "OK" },
  ONLINE: { cls: "ok", icon: IconCheck, label: "Online" },
  RUNNING: { cls: "ok", icon: IconCheck, label: "Running" },
  OPEN: { cls: "ok", icon: IconCheck, label: "Open" },
  COMPLIANT: { cls: "ok", icon: IconCheck, label: "Compliant" },
  RESOLVED: { cls: "neutral", icon: IconCheck, label: "Resolved" },
  RECOVERED: { cls: "neutral", icon: IconCheck, label: "Recovered" },
  ACTIVE: { cls: "crit", icon: IconCrit, label: "Active" },
  FAULT: { cls: "crit", icon: IconCrit, label: "Fault" },
  STOPPED: { cls: "warn", icon: IconWarn, label: "Stopped" },
  CLOSED: { cls: "warn", icon: IconWarn, label: "Closed" },
  WARNING: { cls: "warn", icon: IconWarn, label: "Warning" },
  DEGRADED: { cls: "warn", icon: IconWarn, label: "Degraded" },
  STALE: { cls: "stale", icon: IconStale, label: "Stale" },
  SHORTFALL: { cls: "crit", icon: IconCrit, label: "Shortfall" },
  VIOLATED: { cls: "crit", icon: IconCrit, label: "Violated" },
  NON_COMPLIANT: { cls: "crit", icon: IconCrit, label: "Non-compliant" },
  CRITICAL: { cls: "crit", icon: IconCrit, label: "Critical" },
  OFFLINE: { cls: "off", icon: IconOffline, label: "Offline" },
  ACKNOWLEDGED: { cls: "warn", icon: IconWarn, label: "Acknowledged" },
  SIMULATED: { cls: "sim", icon: IconInfo, label: "Simulated" },
  USER_UPLOADED: { cls: "user", icon: IconInfo, label: "User-uploaded" },
  NOT_APPLICABLE: { cls: "neutral", icon: IconInfo, label: "N/A" },
};

export function StatusPill({ status, customLabel }) {
  const key = String(status || "").toUpperCase();
  const entry = STATUS_MAP[key] || { cls: "neutral", icon: IconInfo, label: status || "Unknown" };
  const Icon = entry.icon;
  return (
    <span className={`pill ${entry.cls}`}>
      <Icon size={12} />
      {customLabel || entry.label}
    </span>
  );
}

export function PageHeader({ eyebrow, title, scriptWord, lede, right }) {
  return (
    <div className="page-header">
      <div className="eyebrow">{eyebrow}</div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1>
            {scriptWord ? <span className="serif-i">{scriptWord} </span> : null}
            {title}
          </h1>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {right ? <div style={{ flexShrink: 0, paddingTop: 4 }}>{right}</div> : null}
      </div>
    </div>
  );
}

/* Graceful failure panel — never a white screen when the API is absent. */
export function StatePanel({ kind = "error", title, children, requestId, onRetry, icon }) {
  return (
    <div className="state-panel">
      <div style={{ display: "flex", justifyContent: "center", color: "var(--text-3)" }}>{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {requestId ? <div className="req-id">request id: {requestId}</div> : null}
      {onRetry ? (
        <button className="btn btn-ghost btn-sm" onClick={onRetry} style={{ marginTop: 6 }}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function LoadingPanel({ label = "Loading telemetry…" }) {
  return (
    <div className="state-panel">
      <div className="mono" style={{ letterSpacing: "0.2em", fontSize: 11, color: "var(--text-3)" }}>
        {label.toUpperCase()}
      </div>
      <div
        className="mono"
        style={{ marginTop: 14, color: "var(--accent)", animation: "simPulse 1.2s infinite" }}
      >
        ▮▮▮
      </div>
    </div>
  );
}

export function Notice({ kind = "", title, children }) {
  return (
    <div className={`notice ${kind}`}>
      <IconInfo size={16} />
      <div>
        {title ? <strong>{title} — </strong> : null}
        {children}
      </div>
    </div>
  );
}

/* Shared recharts light-theme bits */
export const CHART = {
  grid: "#e3d9c2",
  tick: "#8a7d67",
  axis: "#c9bda2",
  tooltip: {
    backgroundColor: "#fffdf8",
    border: "1px solid #c9bda2",
    borderRadius: 4,
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    color: "#211c15",
    boxShadow: "0 8px 24px rgba(33,28,21,0.15)",
  },
  /* restrained industrial ramps — no rainbow */
  gas: { ch4: "#b0763a", co2: "#6b5ca5", co: "#b3372a", o2: "#5f7a3d" },
  climate: { temp: "#b97e14", wetBulb: "#c06a1f", humidity: "#4e7d8a", pressure: "#4e5a66" },
  flow: { airflow: "#8a5a24", velocity: "#6b6250", fanRpm: "#211c15" },
  lineColors: ["#8a5a24", "#b97e14", "#5f7a3d", "#6b5ca5", "#b3372a", "#4e5a66"],
};

export function ChartTooltip({ active, payload, label, labelFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={CHART.tooltip} className="mono">
      <div style={{ color: "var(--text-3)", marginBottom: 4 }}>{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || p.stroke }}>
          {p.name}: {p.value === null || p.value === undefined ? "gap" : p.value}
        </div>
      ))}
    </div>
  );
}

export function CrumbLink({ to, children }) {
  return (
    <Link to={to} className="mono" style={{ fontSize: 11.5 }}>
      ← {children}
    </Link>
  );
}

/* Small confirm dialog for destructive control actions. */
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger = false, onConfirm, onCancel, busy }) {
  if (!open) return null;
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-scrim" style={{ position: "absolute" }} onClick={onCancel} />
      <div className="modal" style={{ position: "relative" }}>
        <h3 style={{ marginBottom: 10 }}>{title}</h3>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 18 }}>{body}</div>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

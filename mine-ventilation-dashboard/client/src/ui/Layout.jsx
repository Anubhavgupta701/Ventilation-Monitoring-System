import React, { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useInspector } from "./InspectorContext";
import { useToast } from "./toast";
import { ageOf, fmtDurationHMS } from "../lib/format";
import { Simulator } from "../lib/api";
import Inspector from "./Inspector";
import {
  BrandMark,
  IconAudit, IconBell, IconCalc, IconChart, IconDoc, IconFan, IconGauge,
  IconLayers, IconLogout, IconMap, IconPause, IconPlay, IconReset, IconSensor,
  IconSettings, IconShield, IconSim, IconBranch, IconUsers, IconSearch,
} from "./icons";

const NAV = [
  { to: "/overview", label: "Overview", icon: IconGauge, group: "Monitor" },
  { to: "/network", label: "Ventilation network", icon: IconMap, group: "Monitor" },
  { to: "/sensors", label: "Sensors", icon: IconSensor, group: "Monitor" },
  { to: "/fans", label: "Fans", icon: IconFan, group: "Monitor" },
  { to: "/airways", label: "Airways", icon: IconBranch, group: "Monitor" },
  { to: "/alerts", label: "Alerts", icon: IconBell, group: "Monitor" },
  { to: "/simulation", label: "Simulation", icon: IconSim, group: "Control" },
  { to: "/analytics", label: "Analytics", icon: IconChart, group: "Analyse" },
  { to: "/calculator", label: "Ventilation calculator", icon: IconCalc, group: "Analyse" },
  { to: "/dataset", label: "Dataset analysis", icon: IconDoc, group: "Analyse" },
  { to: "/thresholds", label: "Threshold profiles", icon: IconShield, group: "Govern" },
  { to: "/reports", label: "Reports", icon: IconDoc, group: "Govern" },
  { to: "/audit", label: "Audit log", icon: IconAudit, group: "Govern" },
  { to: "/settings", label: "System settings", icon: IconSettings, group: "Govern", minRole: "Officer" },
  { to: "/users", label: "Users", icon: IconUsers, group: "Govern", minRole: "Admin", tag: "admin" },
];

function Footer() {
  return (
    <footer className="footer">
      <span>
        Academic Research Prototype — not a certified mine-safety system. All values simulated.
      </span>
      <span className="mono">DATA MODE: SIMULATION · IST (Asia/Kolkata)</span>
    </footer>
  );
}

function HealthBadge({ status }) {
  const s = String(status || "NORMAL").toUpperCase();
  const cls = s === "NORMAL" ? "ok" : s === "CRITICAL" ? "crit" : "warn";
  const label = s === "NORMAL" ? "NORMAL" : s === "CRITICAL" ? "CRITICAL" : "WARNING";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" style={{ width: 7, height: 7, background: "currentColor" }} />
      Health · {label}
    </span>
  );
}

function Transport() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { sim } = useRealtime();
  const [busy, setBusy] = useState(null);
  const canControl = hasRole("Operator");
  const paused = sim.paused ?? !sim.running;

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      pushToast(label, "success");
    } catch (e) {
      pushApiError(e, label);
    } finally {
      setBusy(null);
    }
  };

  if (!canControl) {
    return (
      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }} title="Sim transport needs the Operator role">
        transport locked · read-only role
      </span>
    );
  }

  return (
    <div className="transport" role="group" aria-label="Simulation transport">
      <button
        className={`tbtn ${paused ? "" : "warn-active"}`}
        disabled={!!busy || paused}
        onClick={() => act("Simulation paused.", () => Simulator.pause())}
        title="Pause (Space)"
      >
        <IconPause size={13} /> Pause
      </button>
      <button
        className={`tbtn ${paused ? "active" : ""}`}
        disabled={!!busy || !paused}
        onClick={() => act("Simulation resumed.", () => Simulator.resume())}
        title="Resume (Space)"
      >
        <IconPlay size={13} /> {sim.paused ? "Resume" : "Live"}
      </button>
      {[1, 2, 5, 10].map((s) => (
        <button
          key={s}
          className={`tbtn ${sim.speed === s ? "active" : ""}`}
          disabled={!!busy}
          onClick={() => act(`Speed → ${s}×.`, () => Simulator.setSpeed(s))}
          title={`Set speed ${s}×`}
        >
          {s}×
        </button>
      ))}
      <button
        className="tbtn"
        disabled={!!busy}
        onClick={() => act("Simulation reset.", () => Simulator.reset())}
        title="Reset (R)"
      >
        <IconReset size={13} />
      </button>
    </div>
  );
}

export default function Layout({ onOpenPalette }) {
  const { user, logout, hasRole } = useAuth();
  const { connected, lastMsgAt, sim, overallStatus } = useRealtime();
  const { clear } = useInspector();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const openPalette = useCallback(() => {
    if (onOpenPalette) onOpenPalette();
  }, [onOpenPalette]);

  let lastGroup = null;
  const disconnected = !connected;
  const paused = sim.paused ?? !sim.running;
  const health = overallStatus || sim.overallStatus || "NORMAL";
  const faults = sim.activeFaults?.length || 0;

  return (
    <>
      <div className="sim-strip" role="note" aria-label="Simulated data notice">
        <span className="pulse" />
        Data mode: simulation — not live mine instrumentation
        <span className="pulse" />
      </div>
      <div className="topbar">
        <div className="title-block">
          <div className="crumb">Control room</div>
          <div className="mine-name">Demo Underground Mine</div>
        </div>
        <div className="head-group">
          {disconnected ? (
            <span className="live-tag down">
              <span className="dot" /> link lost
            </span>
          ) : paused ? (
            <span className="live-tag paused">
              <span className="dot" /> paused
            </span>
          ) : (
            <span className="live-tag">
              <span className="dot" /> live
            </span>
          )}
        </div>
        <div className="head-group">
          <div>
            <span className="head-label">Sim clock</span>
            <span className="head-value">{sim.simTime ? fmtDurationHMS(sim.simTime) : "—"}</span>
          </div>
        </div>
        <div className="head-group">
          <HealthBadge status={health} />
          {faults > 0 ? (
            <span className="pill crit">{faults} active fault{faults === 1 ? "" : "s"}</span>
          ) : null}
        </div>
        <div className="head-group">
          <span className="pill sim">Data: simulation</span>
        </div>
        <div className="spacer" />
        <div className="head-group">
          <Transport />
        </div>
        <div className="head-group">
          <button
            className="btn btn-ghost btn-sm"
            onClick={openPalette}
            title="Command palette (Ctrl+K)"
            aria-label="Open command palette"
          >
            <IconSearch size={14} />
            <span className="mono" style={{ fontSize: 10.5 }}>Ctrl+K</span>
          </button>
        </div>
      </div>
      <div className="shell">
        <aside className="side-rail">
          <div className="brand">
            <div className="brand-mark">
              <BrandMark />
              <div>
                <div className="brand-name">
                  <span className="serif-i">Vent</span>Monitor
                </div>
                <div className="brand-sub">Mine ventilation · sim</div>
              </div>
            </div>
          </div>
          <nav className="nav" aria-label="Primary">
            {NAV.filter((n) => !n.minRole || hasRole(n.minRole)).map((n) => {
              const groupLabel = n.group !== lastGroup ? n.group : null;
              lastGroup = n.group;
              const Icon = n.icon;
              return (
                <React.Fragment key={n.to}>
                  {groupLabel ? <div className="nav-group-label">{groupLabel}</div> : null}
                  <NavLink
                    to={n.to}
                    className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                    onClick={() => clear()}
                  >
                    <Icon size={17} />
                    {n.label}
                    {n.tag ? <span className="role-tag">{n.tag}</span> : null}
                  </NavLink>
                </React.Fragment>
              );
            })}
          </nav>
          <div className="user-chip">
            <div className="avatar">{(user?.username || "?").slice(0, 1).toUpperCase()}</div>
            <div className="who">
              <div className="u">{user?.username}</div>
              <div className="r">{user?.role}</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              style={{ padding: "6px 8px" }}
            >
              <IconLogout size={15} />
            </button>
          </div>
        </aside>

        <div className={`main-col${disconnected ? " live-dim" : ""}`}>
          {disconnected ? (
            <div className="disc-banner" role="alert">
              <strong>LIVE LINK LOST</strong>
              <span>
                — reconnecting. Live values are greyed out; showing last known data
                {lastMsgAt ? (
                  <>
                    {" "}from <span className="mono">{ageOf(lastMsgAt)} ago</span>
                  </>
                ) : (
                  " (no data received yet)"
                )}
                .
              </span>
            </div>
          ) : null}
          <main className="page" key={location.pathname}>
            <Outlet />
          </main>
          <Footer />
        </div>

        <aside className="inspector" aria-label="Inspector panel">
          <Inspector />
        </aside>
      </div>
    </>
  );
}

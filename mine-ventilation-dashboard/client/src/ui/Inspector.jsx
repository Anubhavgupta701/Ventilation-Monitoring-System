import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInspector } from "./InspectorContext";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "./toast";
import { StatusPill } from "./primitives";
import { Doors, Fans, Regulators } from "../lib/api";
import { fmtNum, fmtTimeSecIST, paramLabel, paramUnit, sortParams } from "../lib/format";
import { IconX } from "./icons";

function KV({ k, v }) {
  return (
    <div className="insp-kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="insp-sec">
      <div className="eyebrow">{title}</div>
      {children}
    </div>
  );
}

function FanControls({ fan, onDone }) {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const canControl = hasRole("Operator");
  const [rpm, setRpm] = useState(fan?.rpm ?? 0);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    setRpm(fan?.rpm ?? 0);
  }, [fan?.fanId, fan?.rpm]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      pushToast(`${fan.fanId}: ${label} sent.`, "success");
      onDone && onDone();
    } catch (e) {
      pushApiError(e, `${label} failed.`);
    } finally {
      setBusy(null);
    }
  };

  if (!fan) return <div className="insp-empty">Fan data unavailable.</div>;
  return (
    <>
      <Section title="Telemetry">
        <KV k="Status" v={fan.status || "—"} />
        <KV k="Speed" v={`${fmtNum(fan.rpm, 0)} / ${fmtNum(fan.ratedRpm, 0)} rpm`} />
        <KV k="Airflow" v={`${fmtNum(fan.airflowM3min, 1)} m³/min`} />
        <KV k="Pressure" v={`${fmtNum(fan.pressurePa, 0)} Pa`} />
        <KV k="Power" v={`${fmtNum(fan.powerKw, 1)} kW`} />
        <KV k="Efficiency" v={`${fmtNum(fan.efficiencyPct, 1)} %`} />
        <KV k="Auto mode" v={fan.auto ? "ON" : "OFF"} />
        {fan.fault ? <KV k="Fault" v={fan.fault} /> : null}
        <KV k="Runtime" v={`${fmtNum(fan.runtimeHours, 1)} h`} />
      </Section>
      {canControl ? (
        <Section title="Control">
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button
              className="btn btn-ok btn-sm"
              disabled={busy || fan.status === "RUNNING"}
              onClick={() => act("start", () => Fans.start(fan.fanId))}
            >
              Start
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={busy || fan.status === "STOPPED"}
              onClick={() => act("stop", () => Fans.stop(fan.fanId))}
            >
              Stop
            </button>
            <button
              className={`btn btn-sm ${fan.auto ? "btn-warn" : "btn-ghost"}`}
              disabled={!!busy}
              onClick={() => act(fan.auto ? "auto off" : "auto on", () => Fans.setAuto(fan.fanId, !fan.auto))}
            >
              Auto {fan.auto ? "on" : "off"}
            </button>
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              Speed setpoint <span className="unit-tag">{fmtNum(rpm, 0)} rpm</span>
            </label>
            <input
              type="range"
              min={0}
              max={fan.ratedRpm || 1000}
              step={10}
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value))}
              aria-label="Fan speed setpoint"
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy === "rpm" || Number(rpm) === Number(fan.rpm)}
            onClick={() => act("rpm", () => Fans.setRpm(fan.fanId, Number(rpm)))}
          >
            {busy === "rpm" ? "Sending…" : "Apply speed"}
          </button>
        </Section>
      ) : (
        <NoticeInline text="Fan control needs the Operator role or above." />
      )}
    </>
  );
}

function NoticeInline({ text }) {
  return <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>{text}</div>;
}

function DoorControls({ door, onDone }) {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const canControl = hasRole("Operator");
  const [busy, setBusy] = useState(false);
  if (!door) return <div className="insp-empty">Door data unavailable.</div>;
  const act = async (open) => {
    setBusy(true);
    try {
      await (open ? Doors.open(door.doorId) : Doors.close(door.doorId));
      pushToast(`${door.doorId} ${open ? "opening" : "closing"}.`, "success");
      onDone && onDone();
    } catch (e) {
      pushApiError(e, "Door command failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Telemetry">
        <KV k="Status" v={door.status || "—"} />
        <KV k="Position" v={`${fmtNum(door.positionPct, 0)} %`} />
        <KV k="ΔP across" v={`${fmtNum(door.pressureDiffPa, 0)} Pa`} />
        <KV k="Airflow impact" v={`${fmtNum(door.airflowImpactPct, 1)} %`} />
      </Section>
      {canControl ? (
        <Section title="Control">
          <div className="btn-row">
            <button className="btn btn-ok btn-sm" disabled={busy || door.status === "OPEN"} onClick={() => act(true)}>
              Open
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy || door.status === "CLOSED"} onClick={() => act(false)}>
              Close
            </button>
          </div>
        </Section>
      ) : (
        <NoticeInline text="Door control needs the Operator role or above." />
      )}
    </>
  );
}

function RegulatorControls({ reg, onDone }) {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const canControl = hasRole("Operator");
  const [opening, setOpening] = useState(reg?.openingPct ?? 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOpening(reg?.openingPct ?? 0);
  }, [reg?.regulatorId, reg?.openingPct]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!reg) return <div className="insp-empty">Regulator data unavailable.</div>;
  const apply = async () => {
    setBusy(true);
    try {
      await Regulators.setOpening(reg.regulatorId, Number(opening));
      pushToast(`${reg.regulatorId} opening → ${opening}%.`, "success");
      onDone && onDone();
    } catch (e) {
      pushApiError(e, "Regulator command failed.");
    } finally {
      setBusy(false);
    }
  };
  const nudge = async (delta) => {
    setBusy(true);
    try {
      await Regulators.nudge(reg.regulatorId, delta);
      pushToast(`${reg.regulatorId} ${delta > 0 ? "+" : ""}${delta}%.`, "success");
      onDone && onDone();
    } catch (e) {
      pushApiError(e, "Regulator command failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Telemetry">
        <KV k="Opening" v={`${fmtNum(reg.openingPct, 0)} %`} />
        <KV k="Resistance" v={`${fmtNum(reg.resistanceNs2m8, 4)} Ns²/m⁸`} />
        <KV k="Pressure loss" v={`${fmtNum(reg.pressureLossPa, 0)} Pa`} />
        <KV k="Airflow" v={`${fmtNum(reg.airflowM3min, 1)} m³/min`} />
      </Section>
      {canControl ? (
        <Section title="Control">
          <div className="field" style={{ marginBottom: 6 }}>
            <label>
              Blade opening <span className="unit-tag">{fmtNum(opening, 0)} %</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opening}
              onChange={(e) => setOpening(Number(e.target.value))}
              aria-label="Regulator opening"
            />
          </div>
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy || Number(opening) === Number(reg.openingPct)} onClick={apply}>
              {busy ? "Sending…" : "Apply opening"}
            </button>
            {[["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]].map(([label, delta]) => (
              <button
                key={label}
                className="btn btn-ghost btn-sm mono"
                disabled={busy}
                title={`Nudge ${delta > 0 ? "+" : ""}${delta}%`}
                onClick={() => nudge(delta)}
              >
                {label}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpening(Math.min(100, Number(reg.openingPct || 0) + 10))}>
              +10
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpening(Math.max(0, Number(reg.openingPct || 0) - 10))}>
              −10
            </button>
          </div>
        </Section>
      ) : (
        <NoticeInline text="Regulator control needs the Operator role or above." />
      )}
    </>
  );
}

function SensorBody({ id }) {
  const { readings, statuses } = useRealtime();
  const live = readings[id];
  const st = statuses[id]?.status;
  const vals = live?.values || null;
  return (
    <>
      <Section title="Live">
        <KV k="Status" v={st || "—"} />
        <KV k="Last reading" v={live?.measuredAt ? fmtTimeSecIST(live.measuredAt) : "—"} />
        {vals ? (
          sortParams(Object.keys(vals)).map((p) => (
            <KV key={p} k={paramLabel(p)} v={`${fmtNum(vals[p], 1)} ${paramUnit(p)}`} />
          ))
        ) : (
          <NoticeInline text="No live values yet — the simulator publishes on tick." />
        )}
      </Section>
      <Section title="Open">
        <Link className="btn btn-ghost btn-sm" to={`/sensors/${id}`}>
          Sensor detail →
        </Link>
      </Section>
    </>
  );
}

function BranchBody({ id, data }) {
  const { sim } = useRealtime();
  const live = sim.branches?.[id] || data?.live || {};
  return (
    <>
      <Section title="Live airway">
        <KV k="Airflow" v={`${fmtNum(live.q ?? live.airflowM3min, 1)} m³/min`} />
        <KV k="Velocity" v={`${fmtNum(live.v ?? live.velocityMs, 2)} m/s`} />
        <KV k="Pressure drop" v={`${fmtNum(live.dp ?? live.pressureDropPa, 0)} Pa`} />
        <KV k="Status" v={live.status || "—"} />
        {data?.resistanceNs2m8 != null ? <KV k="Resistance" v={`${fmtNum(data.resistanceNs2m8, 4)} Ns²/m⁸`} /> : null}
        {data?.lengthM != null ? <KV k="Length" v={`${fmtNum(data.lengthM, 0)} m`} /> : null}
      </Section>
      <Section title="Open">
        <Link className="btn btn-ghost btn-sm" to="/airways">
          All airways →
        </Link>
      </Section>
    </>
  );
}

export default function Inspector() {
  const { sel, clear } = useInspector();
  const { sim, equipmentTick } = useRealtime(); // eslint-disable-line no-unused-vars
  const [, force] = useState(0);

  /* Re-render when equipment updates arrive over the socket. */
  useEffect(() => {
    force((n) => n + 1);
  }, [equipmentTick]);

  const title = useMemo(() => {
    if (!sel) return null;
    const labels = {
      sensor: "Sensor",
      branch: "Airway",
      fan: "Fan",
      door: "Ventilation door",
      regulator: "Regulator",
      alert: "Alert",
      kpi: "Indicator",
    };
    return labels[sel.kind] || sel.kind;
  }, [sel]);

  const heading = useMemo(() => {
    if (!sel) return "";
    const d = sel.data || {};
    return d.name || sel.id || "";
  }, [sel]);

  if (!sel) {
    return (
      <div className="insp-empty">
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", marginBottom: 10 }}>
          INSPECTOR
        </div>
        Select any sensor, airway, fan, door or regulator on the map — live values and
        working controls appear here.
      </div>
    );
  }

  const refresh = () => force((n) => n + 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.2em", color: "var(--accent)" }}>
            {String(title).toUpperCase()}
          </div>
          <h3 style={{ marginTop: 4 }}>{heading}</h3>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{sel.id}</div>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={clear} aria-label="Close inspector">
          <IconX size={13} />
        </button>
      </div>

      {sel.data?.status ? (
        <div style={{ marginBottom: 14 }}>
          <StatusPill status={sel.data.status} />
        </div>
      ) : null}

      {sel.kind === "sensor" ? <SensorBody id={sel.id} /> : null}
      {sel.kind === "branch" ? <BranchBody id={sel.id} data={sel.data} /> : null}
      {sel.kind === "fan" ? <FanControls fan={sel.data} onDone={refresh} /> : null}
      {sel.kind === "door" ? <DoorControls door={sel.data} onDone={refresh} /> : null}
      {sel.kind === "regulator" ? <RegulatorControls reg={sel.data} onDone={refresh} /> : null}
      {sel.kind === "alert" ? (
        <Section title="Alert">
          <KV k="Parameter" v={sel.data?.parameter || "—"} />
          <KV k="Severity" v={sel.data?.severity || "—"} />
          <KV k="Value" v={sel.data?.triggerValue ?? "—"} />
          <div style={{ marginTop: 10 }}>
            <Link className="btn btn-ghost btn-sm" to="/alerts">
              Open alert desk →
            </Link>
          </div>
        </Section>
      ) : null}
      {sel.kind === "kpi" ? (
        <Section title="Indicator">
          <KV k="Value" v={sel.data?.value ?? "—"} />
          <div style={{ marginTop: 10 }}>
            <Link className="btn btn-ghost btn-sm" to="/analytics">
              Open analytics →
            </Link>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

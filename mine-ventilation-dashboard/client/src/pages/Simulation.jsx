import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Audit, Simulator } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import TimeMachine from "../ui/TimeMachine";
import { LoadingPanel, Notice, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { ageOf, fmtDateTimeIST, fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

/* 12 fault definitions — ids match the simulator's fault contract exactly. */
const FAULT_CATALOG = [
  { id: "main-fan-failure", name: "Main fan failure", cat: "Equipment", severity: "CRITICAL", target: "none", desc: "Main fan trips on a drive fault. Airflow collapses, gases accumulate on the returns." },
  { id: "aux-fan-failure", name: "Auxiliary fan failure", cat: "Equipment", severity: "WARNING", target: "fan", defaultTarget: "FAN-AUX-1", desc: "Auxiliary fan stops. Local working faces lose forced ventilation." },
  { id: "regulator-changed", name: "Regulator tampered", cat: "Airflow", severity: "WARNING", target: "regulator", defaultTarget: "R-01", desc: "A regulator opening is forced down to 15%. The branch starves, pressure redistributes." },
  { id: "door-closed", name: "Ventilation door left closed", cat: "Airflow", severity: "WARNING", target: "door", defaultTarget: "D-01", desc: "A ventilation door is left closed, choking its branch — the parallel branch picks up the flow." },
  { id: "methane-spike", name: "Methane pocket release", cat: "Gas", severity: "CRITICAL", target: "branch", defaultTarget: "B-W3", desc: "A sudden methane pocket releases into an airway — CH₄ spikes toward its LEL (auto-recovers in 3 min)." },
  { id: "airflow-reduction", name: "Airflow reduction", cat: "Airflow", severity: "WARNING", target: "none", desc: "Main fan derated to 60% rpm; circuit airflow falls." },
  { id: "pressure-rise", name: "Return airway blockage", cat: "Airflow", severity: "WARNING", target: "none", desc: "Partial blockage in the main return; circuit pressure rises." },
  { id: "high-temperature", name: "High temperature zones", cat: "Environment", severity: "WARNING", target: "none", desc: "+8 °C heat load on all working branches." },
  { id: "sensor-failure", name: "Sensor failure", cat: "Instrumentation", severity: "WARNING", target: "sensor", defaultTarget: "S4", desc: "A sensor goes OFFLINE and stops reporting." },
  { id: "comm-loss", name: "Comms loss", cat: "Instrumentation", severity: "WARNING", target: "sensor", defaultTarget: "S5", desc: "A station drops off the mesh — readings freeze, STALE alert raised." },
  { id: "multi-sensor-failure", name: "Multi-sensor failure", cat: "Instrumentation", severity: "CRITICAL", target: "none", desc: "Three gas-monitoring sensors go OFFLINE at once." },
  { id: "power-failure", name: "Power outage", cat: "Infrastructure", severity: "CRITICAL", target: "none", desc: "Surface power trips. Fans coast down; ventilation collapses to zero." },
];

const CAT_SEV = { CRITICAL: "crit", WARNING: "warn" };

function TargetSelect({ kind, value, onChange, sim, defaultTarget }) {
  const options = useMemo(() => {
    if (kind === "fan") return (sim.fans || []).map((f) => ({ id: f.fanId, label: `${f.fanId} — ${f.name || ""}`.trim() }));
    if (kind === "door") return (sim.doors || []).map((d) => ({ id: d.doorId, label: `${d.doorId} — ${d.name || ""}`.trim() }));
    if (kind === "regulator") return (sim.regulators || []).map((r) => ({ id: r.regulatorId, label: `${r.regulatorId} — ${r.name || ""}`.trim() }));
    if (kind === "sensor") return (sim.sensors || []).map((s) => ({ id: s.sensorId || s.id, label: `${s.sensorId || s.id} — ${s.name || ""}`.trim() }));
    if (kind === "branch") return (sim.branchesList || []).map((b) => ({ id: b.branchId, label: `${b.branchId} — ${b.name || ""}`.trim() }));
    return [];
  }, [kind, sim]);
  if (kind === "none" || !options.length) return null;
  const effective = value || (defaultTarget && options.some((o) => o.id === defaultTarget) ? defaultTarget : options[0].id);
  return (
    <select value={effective} onChange={(e) => onChange(e.target.value)} aria-label="Inject target">
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

function ActiveFaultCard({ fault }) {
  const f = fault || {};
  const rows = [
    ["Cause", f.cause || f.description || "—"],
    ["Response", f.response || f.simResponse || "—"],
    ["Affected", Array.isArray(f.affected) ? f.affected.join(", ") : f.affected || f.target || "—"],
    ["Sensor changes", Array.isArray(f.sensorChanges) ? f.sensorChanges.join(" · ") : f.sensorChanges || "—"],
    ["Alerts", Array.isArray(f.alerts) ? f.alerts.join(", ") : f.alerts || "—"],
    ["Operator action", f.operatorAction || f.action || "—"],
  ];
  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--crit)" }}>
      <div className="card-head">
        <span className="eyebrow">Active fault</span>
        <StatusPill status={f.severity || "CRITICAL"} />
      </div>
      <h3 style={{ marginBottom: 4 }}>{f.name || f.faultId}</h3>
      <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 10 }}>
        {f.faultId} · injected {f.injectedAt ? `${fmtDateTimeIST(f.injectedAt)} (${ageOf(f.injectedAt)} ago)` : "—"}
        {f.targetId ? ` · target ${f.targetId}` : ""}
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div className="kv" key={k}>
            <dt>{k}</dt>
            <dd style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text-2)" }}>{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SimulationPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { sim, faultTick } = useRealtime();
  const [scenarios, setScenarios] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [targets, setTargets] = useState({});
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [atIso, setAtIso] = useState(null); // time-machine: null = live

  const canInject = hasRole("Officer");

  const load = useCallback(async () => {
    try {
      const [sc, au] = await Promise.allSettled([
        Simulator.scenarios(),
        Audit.list({ category: "fault", limit: 20 }),
      ]);
      if (sc.status === "fulfilled") {
        const v = sc.value;
        setScenarios(Array.isArray(v) ? v : v?.scenarios || []);
      }
      if (au.status === "fulfilled") {
        const v = au.value;
        setTimeline(Array.isArray(v) ? v : v?.data || v?.events || []);
      }
      setError(null);
    } catch (e) {
      setError(e);
      if (loading) pushApiError(e, "Failed to load simulation data.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (faultTick > 0) load();
  }, [faultTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFaults = sim.activeFaults || [];
  const injected = useMemo(() => new Set(activeFaults.map((f) => f.faultId)), [activeFaults]);

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      pushToast(label, "success");
      load();
    } catch (e) {
      pushApiError(e, label);
    } finally {
      setBusy(null);
    }
  };

  const inject = (fault) => {
    const t = targets[fault.id] || fault.defaultTarget;
    act(`Fault injected: ${fault.name}.`, () =>
      fault.target === "none" ? Simulator.injectFault(fault.id) : Simulator.injectFault(fault.id, t)
    );
  };

  const recover = (faultId) =>
    act(`Fault recovered: ${faultId}.`, () => Simulator.recoverFault(faultId));

  const runScenario = (sc) =>
    act(`Scenario started: ${sc.name || sc.scenarioId}.`, () => Simulator.runScenario(sc.scenarioId));

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Training" scriptWord="Fault" title="injection" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !scenarios.length && !activeFaults.length) {
    return (
      <>
        <PageHeader eyebrow="Training" scriptWord="Fault" title="injection" />
        <StatePanel title="Simulation unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Training"
        scriptWord="Fault"
        title="injection"
        lede="Rehearse ventilation emergencies in a safe sandbox. Every injection and recovery is written to the audit trail — nothing here touches a real mine."
      />

      {!canInject ? (
        <Notice kind="warn" title="Read-only role">
          Fault injection and scenario control need the Officer role or above.
        </Notice>
      ) : null}

      <TimeMachine atIso={atIso} onSelect={setAtIso} />

      {atIso ? (
        <Notice kind="warn" title="Historical view">
          Viewing simulator snapshot at <span className="mono">{fmtDateTimeIST(atIso)}</span>.
          Fault injection is disabled on a historical view — press LIVE in the time machine to
          return to the present.
        </Notice>
      ) : null}

      {/* active faults */}
      <h2 style={{ margin: "24px 0 12px" }}>Active faults ({activeFaults.length})</h2>
      {activeFaults.length === 0 ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          <IconInfo size={16} />
          <div>No faults are currently active. The mine is breathing normally — pick a fault below to inject one.</div>
        </div>
      ) : (
        <>
          {activeFaults.map((f) => (
            <ActiveFaultCard key={f.faultId || f.id} fault={f} />
          ))}
          <div className="btn-row" style={{ marginBottom: 18 }}>
            <button
              className="btn btn-ok btn-sm"
              disabled={!canInject || busy}
              onClick={() => act("All faults recovered.", () => Simulator.recoverAllFaults())}
            >
              Recover all faults
            </button>
          </div>
        </>
      )}

      {/* fault catalog */}
      <h2 style={{ margin: "24px 0 12px" }}>Fault catalogue</h2>
      <div className="fault-grid">
        {FAULT_CATALOG.map((fault) => {
          const active = injected.has(fault.id);
          return (
            <div className={`fault-card${active ? " active-f" : ""}`} key={fault.id}>
              <div className="f-id mono">{fault.id}</div>
              <div className="f-name">{fault.name}</div>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: "8px 0 12px" }}>{fault.desc}</p>
              <div className="f-meta">
                <span className={`pill ${CAT_SEV[fault.severity] || "neutral"}`}>{fault.severity}</span>
                <span className="pill neutral">{fault.cat}</span>
                {active ? <span className="pill crit warn-blink">ACTIVE</span> : null}
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                {fault.target !== "none" ? (
                  <TargetSelect
                    kind={fault.target}
                    value={targets[fault.id]}
                    onChange={(v) => setTargets((p) => ({ ...p, [fault.id]: v }))}
                    sim={sim}
                    defaultTarget={fault.defaultTarget}
                  />
                ) : null}
                {active ? (
                  <button
                    className="btn btn-ok btn-sm"
                    disabled={!canInject || busy}
                    onClick={() => recover(fault.id)}
                  >
                    Recover
                  </button>
                ) : (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={!canInject || busy || !!atIso}
                    onClick={() => inject(fault)}
                  >
                    Inject
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* scenarios */}
      <h2 style={{ margin: "28px 0 12px" }}>Scripted scenarios</h2>
      {scenarios.length === 0 ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          <IconInfo size={16} />
          <div>No scripted scenarios published yet.</div>
        </div>
      ) : (
        <div className="fault-grid">
          {scenarios.map((sc) => (
            <div className="fault-card" key={sc.scenarioId}>
              <div className="f-id mono">{sc.scenarioId}</div>
              <div className="f-name">{sc.name}</div>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: "8px 0 12px" }}>
                {sc.description || "Multi-stage scripted emergency."}
              </p>
              <div className="f-meta">
                {sc.durationMin ? <span className="pill neutral">{fmtNum(sc.durationMin, 0)} min</span> : null}
                {sc.steps ? <span className="pill neutral">{sc.steps.length} steps</span> : null}
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-warn btn-sm"
                  disabled={!canInject || busy || !!atIso}
                  onClick={() => runScenario(sc)}
                >
                  Run scenario
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* incident timeline */}
      <h2 style={{ margin: "28px 0 12px" }}>
        Incident timeline <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>· from audit</span>
      </h2>
      {timeline.length === 0 ? (
        <div className="notice">
          <IconInfo size={16} />
          <div>No fault or scenario events in the audit trail yet.</div>
        </div>
      ) : (
        <div className="timeline">
          {timeline.map((e, i) => (
            <div
              className={`tl-item${/inject|fire|fail/i.test(e.action || e.event || "") ? " crit" : ""}`}
              key={e._id || e.id || i}
            >
              <div className="tl-ts">{fmtDateTimeIST(e.ts || e.createdAt)}</div>
              <div className="tl-action">{e.action || e.event || e.category}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                {(e.actor || e.by ? `by ${e.actor || e.by}` : "")}
                {(e.detail || e.note) ? ` — ${e.detail || e.note}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-gap">
        <Notice kind="" title="Training sandbox">
          Injected faults propagate through the same correlated engine that drives the live
          dashboard — watch the <Link to="/network">network map</Link> and the{" "}
          <Link to="/alerts">alert desk</Link> as the scenario unfolds.
        </Notice>
      </div>
    </>
  );
}

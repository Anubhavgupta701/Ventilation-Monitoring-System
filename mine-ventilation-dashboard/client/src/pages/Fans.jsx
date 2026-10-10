import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Fans as FansApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import { useInspector } from "../ui/InspectorContext";
import { ConfirmDialog, LoadingPanel, Notice, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

export default function FansPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { equipmentTick, sim } = useRealtime();
  const { select } = useInspector();
  const [fans, setFans] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // {fanId, action:'start'|'stop', label}
  const [rpmEdits, setRpmEdits] = useState({});

  const canControl = hasRole("Operator");

  const load = useCallback(async () => {
    try {
      const d = await FansApi.list();
      setFans(Array.isArray(d) ? d : d?.fans || d?.data || []);
      setError(null);
    } catch (e) {
      setError(e);
      if (loading) pushApiError(e, "Failed to load fans.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  /* refresh on socket equipment updates + sim ticks carrying fan state */
  useEffect(() => {
    if (equipmentTick > 0 || (sim.fans && sim.fans.length)) load();
  }, [equipmentTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    if (fans && fans.length) return fans;
    if (sim.fans && sim.fans.length) return sim.fans;
    return [];
  }, [fans, sim.fans]);

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
      setConfirm(null);
    }
  };

  const applyRpm = (fan, rpm) => {
    const v = Number(rpm);
    if (!Number.isFinite(v) || v < 0) {
      pushToast("Enter a valid non-negative RPM.", "warning");
      return;
    }
    act(`Speed setpoint → ${v} rpm on ${fan.fanId}.`, () => FansApi.setRpm(fan.fanId, v));
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Machines" scriptWord="Fan" title="station" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !list.length) {
    return (
      <>
        <PageHeader eyebrow="Machines" scriptWord="Fan" title="station" />
        <StatePanel title="Fans unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Machines"
        scriptWord="Fan"
        title="station"
        lede="Main and auxiliary fans driving the circuit. Start/stop, speed setpoints and auto mode are operator actions — every command is written to the audit log."
      />

      {!canControl ? (
        <Notice kind="warn" title="Read-only role">
          You are signed in with a read-only role. Fan controls need the Operator role or above.
        </Notice>
      ) : null}

      {list.length === 0 ? (
        <div className="state-panel">
          <h3>No fans registered</h3>
          <p>The simulator has not published any fan records yet.</p>
        </div>
      ) : (
        <div className="fault-grid">
          {list.map((f) => {
            const running = String(f.status).toUpperCase() === "RUNNING";
            const edit = rpmEdits[f.fanId] ?? f.rpm ?? 0;
            const pct = f.ratedRpm ? Math.min(100, Math.max(0, ((f.rpm || 0) / f.ratedRpm) * 100)) : 0;
            return (
              <div className="fault-card" key={f.fanId}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div className="f-id mono">{f.fanId} · {(f.kind || "main").toUpperCase()} FAN</div>
                    <div className="f-name">{f.name || f.fanId}</div>
                  </div>
                  <StatusPill status={f.status} />
                </div>

                <div className="detail-list" style={{ marginTop: 10 }}>
                  <div className="dl-row"><span className="dl-k">Speed</span><span className="dl-v mono">{fmtNum(f.rpm, 0)} / {fmtNum(f.ratedRpm, 0)} rpm</span></div>
                  <div className="dl-row"><span className="dl-k">Airflow</span><span className="dl-v mono">{fmtNum(f.airflowM3min, 1)} m³/min</span></div>
                  <div className="dl-row"><span className="dl-k">Pressure</span><span className="dl-v mono">{fmtNum(f.pressurePa, 0)} Pa</span></div>
                  <div className="dl-row"><span className="dl-k">Power</span><span className="dl-v mono">{fmtNum(f.powerKw, 1)} kW · {fmtNum(f.efficiencyPct, 1)}% eff.</span></div>
                  <div className="dl-row"><span className="dl-k">Auto</span><span className="dl-v">{f.auto ? "ON" : "OFF"}</span></div>
                  {f.fault ? <div className="dl-row"><span className="dl-k">Fault</span><span className="dl-v" style={{ color: "var(--crit)", fontWeight: 700 }}>{f.fault}</span></div> : null}
                  <div className="dl-row"><span className="dl-k">Runtime</span><span className="dl-v mono">{fmtNum(f.runtimeHours, 1)} h</span></div>
                </div>

                <div className="progress-track" style={{ marginTop: 12 }} title={`${fmtNum(pct, 0)}% of rated speed`}>
                  <div className={`progress-fill${running ? " ok" : ""}`} style={{ width: `${pct}%` }} />
                </div>

                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button
                    className="btn btn-ok btn-sm"
                    disabled={!canControl || busy || running}
                    onClick={() => setConfirm({ fanId: f.fanId, action: "start", label: `Start ${f.fanId}?` })}
                  >
                    Start
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={!canControl || busy || !running}
                    onClick={() => setConfirm({ fanId: f.fanId, action: "stop", label: `Stop ${f.fanId}? The circuit will lose its primary airflow source.` })}
                  >
                    Stop
                  </button>
                  <button
                    className={`btn btn-sm ${f.auto ? "btn-warn" : "btn-ghost"}`}
                    disabled={!canControl || busy}
                    onClick={() => act(`Auto mode ${f.auto ? "off" : "on"} — ${f.fanId}.`, () => FansApi.setAuto(f.fanId, !f.auto))}
                  >
                    Auto {f.auto ? "on" : "off"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => select("fan", f.fanId, f)}>
                    Inspect →
                  </button>
                </div>

                {canControl ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      type="number"
                      min={0}
                      max={f.ratedRpm || 1500}
                      step={10}
                      value={edit}
                      onChange={(e) => setRpmEdits((p) => ({ ...p, [f.fanId]: e.target.value }))}
                      aria-label={`Speed setpoint for ${f.fanId}`}
                      style={{ maxWidth: 130 }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy || Number(edit) === Number(f.rpm)}
                      onClick={() => applyRpm(f, edit)}
                    >
                      Set rpm
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === "stop" ? "Stop fan" : "Start fan"}
        body={confirm?.label}
        confirmLabel={confirm?.action === "stop" ? "Stop fan" : "Start fan"}
        danger={confirm?.action === "stop"}
        busy={!!busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act(
            confirm.action === "stop" ? `${confirm.fanId} stopping.` : `${confirm.fanId} starting.`,
            () => (confirm.action === "stop" ? FansApi.stop(confirm.fanId) : FansApi.start(confirm.fanId))
          )
        }
      />

      <div className="section-gap">
        <Notice kind="" title="Coupled physics">
          Fan RPM drives the correlated engine: airflow → velocity → pressure → gas dilution across
          every airway. Watch the network map while you change a setpoint.
        </Notice>
      </div>
    </>
  );
}

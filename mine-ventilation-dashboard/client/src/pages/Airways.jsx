import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Branches, Doors, Regulators } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import { useInspector } from "../ui/InspectorContext";
import { LoadingPanel, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

/* Airways: every branch with live airflow/velocity/pressure + its
   stoppings, doors and regulators. */
export default function AirwaysPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { sim, equipmentTick } = useRealtime();
  const { select } = useInspector();
  const [branches, setBranches] = useState(null);
  const [doors, setDoors] = useState([]);
  const [regs, setRegs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyFit, setBusyFit] = useState(null);
  const canControl = hasRole("Operator");

  const load = useCallback(async () => {
    try {
      const [b, d, r] = await Promise.allSettled([Branches.list(), Doors.list(), Regulators.list()]);
      const un = (res, key) => {
        if (res.status !== "fulfilled") return [];
        const v = res.value;
        return Array.isArray(v) ? v : v?.[key] || v?.data || [];
      };
      setBranches(un(b, "branches"));
      setDoors(un(d, "doors"));
      setRegs(un(r, "regulators"));
      setError(null);
    } catch (e) {
      setError(e);
      if (loading) pushApiError(e, "Failed to load airways.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (equipmentTick > 0) load();
  }, [equipmentTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Inline fitting controls — door open/close and regulator ±1%/±5% nudges,
     wired straight to the API so the physics responds on the next tick. */
  const doorAct = async (door, open) => {
    const key = `door:${door.doorId}`;
    setBusyFit(key);
    try {
      await (open ? Doors.open(door.doorId) : Doors.close(door.doorId));
      pushToast(`${door.doorId} ${open ? "opening" : "closing"} — flow redistributes on the next tick.`, "success");
      load();
    } catch (e) {
      pushApiError(e, "Door command failed.");
    } finally {
      setBusyFit(null);
    }
  };

  const regNudge = async (reg, delta) => {
    const key = `reg:${reg.regulatorId}:${delta}`;
    setBusyFit(key);
    try {
      await Regulators.nudge(reg.regulatorId, delta);
      pushToast(`${reg.regulatorId} ${delta > 0 ? "+" : ""}${delta}% — resistance and branch flow update on the next tick.`, "success");
      load();
    } catch (e) {
      pushApiError(e, "Regulator command failed.");
    } finally {
      setBusyFit(null);
    }
  };

  const rows = useMemo(() => {
    const list = branches || [];
    const live = sim.branches || {};
    const doorsByBranch = new Map();
    doors.forEach((d) => {
      if (!doorsByBranch.has(d.branchId)) doorsByBranch.set(d.branchId, []);
      doorsByBranch.get(d.branchId).push(d);
    });
    const regsByBranch = new Map();
    regs.forEach((r) => {
      if (!regsByBranch.has(r.branchId)) regsByBranch.set(r.branchId, []);
      regsByBranch.get(r.branchId).push(r);
    });
    return list.map((b) => {
      const lv = live[b.branchId] || b.live || {};
      return {
        ...b,
        q: lv.q ?? lv.airflowM3min ?? null,
        v: lv.v ?? lv.velocityMs ?? null,
        dp: lv.dp ?? lv.pressureDropPa ?? null,
        status: lv.status || b.status || "NORMAL",
        doors: doorsByBranch.get(b.branchId) || [],
        regs: regsByBranch.get(b.branchId) || [],
      };
    });
  }, [branches, doors, regs, sim.branches]);

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Ventilation circuit" scriptWord="Air" title="ways" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !rows.length) {
    return (
      <>
        <PageHeader eyebrow="Ventilation circuit" scriptWord="Air" title="ways" />
        <StatePanel title="Airways unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Ventilation circuit"
        scriptWord="Air"
        title="ways"
        lede="Every airway in the circuit with live airflow, velocity and pressure drop — plus the doors, regulators and stoppings fitted on each. Select a row to inspect it on the map."
      />

      {rows.length === 0 ? (
        <div className="state-panel">
          <h3>No airways published</h3>
          <p>The simulator has not published any branch records yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Airway</th>
                <th>Level</th>
                <th className="num">Length m</th>
                <th className="num">Airflow m³/min</th>
                <th className="num">Velocity m/s</th>
                <th className="num">ΔP Pa</th>
                <th className="num">Resistance</th>
                <th>Fittings</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.branchId} className="clickable" onClick={() => select("branch", b.branchId, b)}>
                  <td>
                    <span className="mono" style={{ fontWeight: 700 }}>{b.branchId}</span>
                    <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{b.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{b.direction}</div>
                  </td>
                  <td className="mono">{b.level || "—"}</td>
                  <td className="num mono">{b.lengthM != null ? fmtNum(b.lengthM, 0) : "—"}</td>
                  <td className="num mono live-value">{fmtNum(b.q, 1)}</td>
                  <td className="num mono live-value">{fmtNum(b.v, 2)}</td>
                  <td className="num mono live-value">{fmtNum(b.dp, 0)}</td>
                  <td className="num mono">{b.resistanceNs2m8 != null ? fmtNum(b.resistanceNs2m8, 4) : "—"}</td>
                  <td style={{ fontSize: 12 }}>
                    {b.stoppings ? <div><span className="pill neutral">seals ×{Array.isArray(b.stoppings) ? b.stoppings.length : b.stoppings}</span></div> : null}
                    {b.doors.map((d) => (
                      <div key={d.doorId} style={{ marginTop: 4, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); select("door", d.doorId, d); }}>
                          {d.doorId} · {d.status}
                        </button>
                        {canControl ? (
                          d.status === "OPEN" ? (
                            <button className="btn btn-danger btn-xs" disabled={busyFit === `door:${d.doorId}`} onClick={(e) => { e.stopPropagation(); doorAct(d, false); }}>
                              Close
                            </button>
                          ) : (
                            <button className="btn btn-ok btn-xs" disabled={busyFit === `door:${d.doorId}`} onClick={(e) => { e.stopPropagation(); doorAct(d, true); }}>
                              Open
                            </button>
                          )
                        ) : null}
                      </div>
                    ))}
                    {b.regs.map((r) => (
                      <div key={r.regulatorId} style={{ marginTop: 4, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); select("regulator", r.regulatorId, r); }}>
                          {r.regulatorId} · {fmtNum(r.openingPct, 0)}%
                        </button>
                        {canControl ? (
                          <>
                            {[["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]].map(([label, delta]) => (
                              <button
                                key={label}
                                className="btn btn-ghost btn-xs mono"
                                disabled={busyFit === `reg:${r.regulatorId}:${delta}`}
                                title={`Nudge ${r.regulatorId} ${delta > 0 ? "+" : ""}${delta}%`}
                                onClick={(e) => { e.stopPropagation(); regNudge(r, delta); }}
                              >
                                {label}
                              </button>
                            ))}
                          </>
                        ) : null}
                      </div>
                    ))}
                    {!b.stoppings && !b.doors.length && !b.regs.length ? (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    ) : null}
                  </td>
                  <td><StatusPill status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

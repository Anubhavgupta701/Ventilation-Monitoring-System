import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alerts as AlertsApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import { useInspector } from "../ui/InspectorContext";
import { LoadingPanel, Notice, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { ageOf, fmtDateTimeIST, fmtNum, fmtParamValue, paramLabel, paramUnit } from "../lib/format";
import { IconCheckSmall, IconInfo, IconX } from "../ui/icons";

const STATUSES = ["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"];
const SEVERITIES = ["ALL", "CRITICAL", "WARNING"];

function alertUpdatedAt(alert) {
  const timestamps = [
    alert.openedAt,
    alert.lastSeenAt,
    alert.acknowledgedAt,
    alert.resolvedAt,
    ...(alert.history || []).map((entry) => entry.ts),
  ];
  return timestamps.reduce((latest, value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}

/* Alert detail modal: VIEW SENSOR / VIEW MAP / ACKNOWLEDGE (reason dialog). */
function AlertModal({ alert, onClose, onAcked }) {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { select } = useInspector();
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [acking, setAcking] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const canAck = hasRole("Operator") && alert?.status === "ACTIVE";

  const ack = async () => {
    if (!note.trim()) {
      pushToast("A reason is required — write why this alert is being acknowledged.", "warning");
      return;
    }
    setAcking(true);
    try {
      const updated = await AlertsApi.acknowledge(alert.alertId, note.trim());
      pushToast(`Alert ${alert.alertId} acknowledged — logged to the audit trail.`, "success");
      onAcked(updated?.alertId ? updated : { ...alert, status: "ACKNOWLEDGED", ackNote: note.trim() });
      setReasonOpen(false);
      onClose();
    } catch (err) {
      pushApiError(err, "Could not acknowledge the alert.");
    } finally {
      setAcking(false);
    }
  };

  if (!alert) return null;
  const snap = alert.thresholdSnapshot || {};

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={`Alert ${alert.alertId}`}>
      <div className="drawer-scrim" style={{ position: "absolute" }} onClick={onClose} />
      <div className="modal" style={{ position: "relative", width: "min(640px, 94vw)" }}>
        <div className="drawer-head">
          <div>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.2em", color: "var(--text-3)" }}>
              ALERT {alert.alertId}
            </div>
            <h2 style={{ marginTop: 6 }}>
              {paramLabel(alert.parameter)} — {alert.type}
            </h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <IconX size={14} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <StatusPill status={alert.severity} />
          <StatusPill status={alert.status} />
        </div>

        <dl>
          <div className="kv"><dt>Sensor</dt><dd>{alert.sensorId}</dd></div>
          <div className="kv"><dt>Opened</dt><dd>{fmtDateTimeIST(alert.openedAt)} ({ageOf(alert.openedAt)} ago)</dd></div>
          <div className="kv"><dt>Last seen</dt><dd>{fmtDateTimeIST(alert.lastSeenAt)}</dd></div>
          <div className="kv">
            <dt>Trigger value</dt>
            <dd>{alert.triggerValue != null ? `${fmtParamValue(alert.parameter, alert.triggerValue)} ${snap.unit || paramUnit(alert.parameter)}` : "—"}</dd>
          </div>
          <div className="kv">
            <dt>Peak value</dt>
            <dd>{alert.peakValue != null ? `${fmtParamValue(alert.parameter, alert.peakValue)} ${snap.unit || paramUnit(alert.parameter)}` : "—"}</dd>
          </div>
          {alert.resolvedAt ? (
            <div className="kv"><dt>Resolved</dt><dd>{fmtDateTimeIST(alert.resolvedAt)} · {alert.resolution || ""}</dd></div>
          ) : null}
          {alert.acknowledgedBy ? (
            <div className="kv"><dt>Acknowledged by</dt><dd>{alert.acknowledgedBy} · {fmtDateTimeIST(alert.acknowledgedAt)}</dd></div>
          ) : null}
          {alert.ackNote ? (
            <div className="kv"><dt>Ack note</dt><dd style={{ fontFamily: "var(--sans)" }}>{alert.ackNote}</dd></div>
          ) : null}
        </dl>

        <h3 style={{ margin: "18px 0 10px" }}>Threshold snapshot (frozen at trigger)</h3>
        <dl>
          <div className="kv"><dt>Profile</dt><dd>{snap.profileKey || "—"} {snap.version != null ? `· v${snap.version}` : ""}</dd></div>
          <div className="kv">
            <dt>Limits</dt>
            <dd>
              {snap.warning != null ? `warn ${snap.warning}` : "—"} / {snap.critical != null ? `crit ${snap.critical}` : "—"}{" "}
              {snap.unit || ""} ({snap.comparator || "—"})
            </dd>
          </div>
          <div className="kv"><dt>Source ref</dt><dd style={{ fontFamily: "var(--sans)", fontSize: 12.5 }}>{snap.sourceRef || "—"}</dd></div>
        </dl>

        <h3 style={{ margin: "18px 0 10px" }}>History</h3>
        <div className="timeline">
          {(alert.history || []).map((h, i) => (
            <div className={`tl-item${/crit|inject/i.test(h.action || "") ? " crit" : ""}`} key={i}>
              <div className="tl-ts">{fmtDateTimeIST(h.ts)}</div>
              <div className="tl-action">{h.action}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                {h.by ? `by ${h.by}` : ""}{h.note ? ` — ${h.note}` : ""}
              </div>
            </div>
          ))}
          {(!alert.history || alert.history.length === 0) && (
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>No history entries recorded.</div>
          )}
        </div>

        <div className="btn-row" style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { onClose(); navigate(`/sensors/${alert.sensorId}`); }}
          >
            View sensor →
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { select("sensor", alert.sensorId, { name: alert.sensorId }); onClose(); navigate("/network"); }}
          >
            View map →
          </button>
          <span style={{ flex: 1 }} />
          {canAck ? (
            <button className="btn btn-warn btn-sm" onClick={() => setReasonOpen(true)}>
              <IconCheckSmall size={13} /> Acknowledge…
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              {alert.status !== "ACTIVE" ? "Only active alerts can be acknowledged." : "Acknowledging needs the Operator role or above."}
            </span>
          )}
        </div>

        {reasonOpen ? (
          <div style={{ marginTop: 16, border: "1px solid var(--warn)", borderRadius: 4, padding: 14, background: "var(--warn-soft)" }}>
            <div className="field">
              <label htmlFor="ack-reason">Reason for acknowledgement (required — written to audit)</label>
              <textarea
                id="ack-reason"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Ventilation officer notified; district B return being inspected; fan RPM raised to clear the pocket…"
                autoFocus
              />
            </div>
            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setReasonOpen(false)} disabled={acking}>
                Cancel
              </button>
              <button className="btn btn-warn btn-sm" onClick={ack} disabled={acking}>
                {acking ? "Acknowledging…" : "Acknowledge with reason"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { hasRole } = useAuth();
  const { pushApiError } = useToast();
  const { recentAlerts } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  const statusF = searchParams.get("status") || "ALL";
  const severityF = searchParams.get("severity") || "ALL";
  const sensorF = searchParams.get("sensorId") || "";

  const setFilter = (k, v) => {
    const next = new URLSearchParams(searchParams);
    if (!v || v === "ALL") next.delete(k);
    else next.set(k, v);
    setSearchParams(next);
    setPage(1);
  };

  const load = useCallback(async () => {
    try {
      const q = { page, limit: 25 };
      if (statusF !== "ALL") q.status = statusF;
      if (severityF !== "ALL") q.severity = severityF;
      if (sensorF) q.sensorId = sensorF;
      const d = await AlertsApi.list(q);
      const rows = Array.isArray(d) ? d : d?.data || [];
      setAlerts(rows);
      setTotal(d?.total ?? rows.length);
      setLastChecked(Date.now());
      setError(null);
    } catch (err) {
      setError(err);
      if (loading) pushApiError(err, "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  }, [page, statusF, severityF, sensorF, loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  /* Fold socket alert events into the visible table */
  const rows = useMemo(() => {
    const map = new Map(alerts.map((a) => [a.alertId, a]));
    const latestEvents = new Map();
    [...recentAlerts].reverse().forEach((a) => {
      if (!a?.alertId) return;
      const current = latestEvents.get(a.alertId);
      if (!current || alertUpdatedAt(a) >= alertUpdatedAt(current)) {
        latestEvents.set(a.alertId, a);
      }
    });
    latestEvents.forEach((event, alertId) => {
      const current = map.get(alertId);
      if (!current || alertUpdatedAt(event) > alertUpdatedAt(current)) {
        map.set(alertId, event);
      }
    });
    return [...map.values()]
      .filter((a) => (statusF === "ALL" || a.status === statusF)
        && (severityF === "ALL" || a.severity === severityF)
        && (!sensorF || a.sensorId === sensorF))
      .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  }, [alerts, recentAlerts, statusF, severityF, sensorF]);

  const pages = Math.max(1, Math.ceil(total / 25));

  const handleAcked = (updated) => {
    setAlerts((prev) => prev.map((a) => (a.alertId === updated.alertId ? updated : a)));
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Safety" scriptWord="Alert" title="desk" />
        <LoadingPanel />
      </>
    );
  }

  if (error && alerts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Safety" scriptWord="Alert" title="desk" />
        <StatePanel title="Alerts unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Safety"
        scriptWord="Alert"
        title="desk"
        lede="Every limit, compound-rule and comms breach — filterable, with the frozen threshold snapshot behind each one. Acknowledgement (Operator+) requires a reason and is written to the audit log."
      />

      {!hasRole("Operator") ? (
        <Notice kind="warn" title="Read-only access">
          You are signed in with a role that cannot acknowledge alerts. The acknowledge control is
          hidden for your role; the server enforces this too.
        </Notice>
      ) : null}

      <div className="map-toolbar">
        <div className="chip-row" role="group" aria-label="Status filter">
          {STATUSES.map((s) => (
            <button key={s} className={`chip${statusF === s ? " active" : ""}`} onClick={() => setFilter("status", s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="chip-row" role="group" aria-label="Severity filter">
          {SEVERITIES.map((s) => (
            <button key={s} className={`chip${severityF === s ? " active" : ""}`} onClick={() => setFilter("severity", s)}>
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Sensor id, e.g. S4"
          value={sensorF}
          onChange={(e) => setFilter("sensorId", e.target.value.trim())}
          style={{ maxWidth: 180 }}
          aria-label="Filter by sensor"
        />
      </div>

      {rows.length === 0 ? (
        <div className="state-panel">
          <h3>No alerts match these filters</h3>
          <p>
            The desk is clear for this selection.
            {lastChecked ? <> Last checked <span className="mono">{fmtDateTimeIST(lastChecked)}</span>.</> : null}
            {" "}Widen the filters to see resolved history.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Alert</th>
                <th className="num">Trigger</th>
                <th className="num">Peak</th>
                <th className="num">Opened</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.alertId} className="clickable" onClick={() => setSelected(a)}>
                  <td><StatusPill status={a.severity} /></td>
                  <td>
                    <span className="mono" style={{ fontWeight: 700 }}>{a.sensorId}</span>
                    <span style={{ color: "var(--text-3)" }}> · </span>
                    <span className="mono">{paramLabel(a.parameter)}</span>
                    <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                      {a.type} · {a.alertId}
                    </div>
                  </td>
                  <td className="num mono">
                    {a.triggerValue != null ? fmtNum(a.triggerValue, 3) : "—"}
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                      {a.thresholdSnapshot?.unit || paramUnit(a.parameter)}
                    </div>
                  </td>
                  <td className="num mono">
                    {a.peakValue != null ? fmtNum(a.peakValue, 3) : "—"}
                  </td>
                  <td className="num mono" style={{ fontSize: 12 }} title={fmtDateTimeIST(a.openedAt)}>
                    {ageOf(a.openedAt) ? `${ageOf(a.openedAt)} ago` : "—"}
                  </td>
                  <td><StatusPill status={a.status} /></td>
                  <td>
                    {hasRole("Operator") && a.status === "ACTIVE" ? (
                      <button
                        className="btn btn-warn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(a);
                        }}
                      >
                        Review
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Newer
        </button>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
          page {page} of {pages} · {total} alerts
        </span>
        <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Older →
        </button>
      </div>

      <AlertModal alert={selected} onClose={() => setSelected(null)} onAcked={handleAcked} />
    </>
  );
}

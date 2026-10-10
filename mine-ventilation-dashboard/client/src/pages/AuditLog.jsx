import React, { useCallback, useEffect, useState } from "react";
import { Audit } from "../lib/api";
import { useToast } from "../ui/toast";
import { LoadingPanel, PageHeader, StatePanel } from "../ui/primitives";
import { fmtDateTimeIST } from "../lib/format";
import { IconInfo } from "../ui/icons";

const CATEGORIES = ["ALL", "alert", "fan", "door", "regulator", "fault", "scenario", "threshold", "report", "user", "simulator"];

export default function AuditLogPage() {
  const { pushApiError } = useToast();
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("ALL");
  const [actor, setActor] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = { page, limit: 30 };
      if (category !== "ALL") q.category = category;
      if (actor) q.actor = actor;
      const d = await Audit.list(q);
      const rows = Array.isArray(d) ? d : d?.data || d?.events || [];
      setEvents(rows);
      setTotal(d?.total ?? rows.length);
      setError(null);
    } catch (e) {
      setError(e);
      if (loading) pushApiError(e, "Failed to load audit trail.");
    } finally {
      setLoading(false);
    }
  }, [page, category, actor, loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / 30));

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Accountability" scriptWord="Audit" title="trail" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !events.length) {
    return (
      <>
        <PageHeader eyebrow="Accountability" scriptWord="Audit" title="trail" />
        <StatePanel title="Audit trail unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        scriptWord="Audit"
        title="trail"
        lede="Every control action, acknowledgement, threshold change and fault injection — who did it, when, and what was set. This is the record behind every number on the dashboard."
      />

      <div className="map-toolbar">
        <div className="chip-row" role="group" aria-label="Category filter" style={{ flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`chip${category === c ? " active" : ""}`} onClick={() => { setCategory(c); setPage(1); }}>
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setActor(actorQuery.trim());
            setPage(1);
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="text"
            placeholder="Actor, e.g. operator1"
            value={actorQuery}
            onChange={(e) => setActorQuery(e.target.value)}
            style={{ maxWidth: 200 }}
            aria-label="Filter by actor"
          />
          <button className="btn btn-ghost btn-sm" type="submit">Filter</button>
          {actor ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => { setActor(""); setActorQuery(""); setPage(1); }}
            >
              Clear
            </button>
          ) : null}
        </form>
      </div>

      {events.length === 0 ? (
        <div className="state-panel">
          <h3>No audit entries</h3>
          <p>Nothing matches this selection yet.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Category</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={e._id || e.id || i}>
                    <td className="mono" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {fmtDateTimeIST(e.ts || e.createdAt || e.at)}
                    </td>
                    <td>
                      <span className="pill neutral">{e.category || "—"}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.action || e.event || "—"}</td>
                    <td style={{ fontSize: 12.5 }}>{e.actor || e.by || e.username || "system"}</td>
                    <td style={{ fontSize: 12.5, color: "var(--text-2)", maxWidth: 420 }}>
                      {e.detail || e.note || e.summary || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Newer
            </button>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
              page {page} of {pages} · {total} entries
            </span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Older →
            </button>
          </div>
        </>
      )}
    </>
  );
}

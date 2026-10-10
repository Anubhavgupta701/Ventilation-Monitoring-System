import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Thresholds as ThresholdsApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ui/toast";
import { LoadingPanel, Notice, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { fmtDateIST, locationLabel, paramLabel } from "../lib/format";
import { IconInfo, IconPlus } from "../ui/icons";

function SourceTypeBadge({ t }) {
  if (t === "STATUTORY") return <span className="pill info">Statutory</span>;
  if (t === "DEMO") return <span className="pill sim">Demo</span>;
  if (t === "MINE_PLAN") return <span className="pill neutral">Mine plan</span>;
  return <span className="pill neutral">{t || "—"}</span>;
}

export default function ThresholdsPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    profileKey: "",
    warning: "",
    critical: "",
    sourceRef: "",
    sourceDate: "",
    verificationNote: "verified via secondary source — cross-check pending",
  });
  const [saving, setSaving] = useState(false);

  const canManage = hasRole("Ventilation Officer");

  const load = useCallback(async () => {
    try {
      const d = await ThresholdsApi.list();
      const list = Array.isArray(d) ? d : d?.data || [];
      setProfiles(list);
      setError(null);
    } catch (err) {
      setError(err);
      if (loading) pushApiError(err, "Failed to load threshold profiles.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map();
    (profiles || []).forEach((p) => {
      if (!m.has(p.profileKey)) m.set(p.profileKey, []);
      m.get(p.profileKey).push(p);
    });
    return [...m.entries()].map(([key, versions]) => ({
      key,
      versions: versions.sort((a, b) => (b.version || 0) - (a.version || 0)),
    }));
  }, [profiles]);

  const toggleEnabled = async (p) => {
    try {
      await ThresholdsApi.setEnabled(p.profileKey, !p.enabled);
      pushToast(
        `${p.profileKey} v${p.version} ${p.enabled ? "disabled" : "enabled"}.`,
        "success"
      );
      load();
    } catch (err) {
      pushApiError(err, "Could not change the enabled flag.");
    }
  };

  const createVersion = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        profileKey: form.profileKey,
        version: undefined,
        warning: form.warning === "" ? null : Number(form.warning),
        critical: form.critical === "" ? null : Number(form.critical),
        sourceRef: form.sourceRef || undefined,
        sourceDate: form.sourceDate || undefined,
        verificationNote: form.verificationNote || undefined,
      };
      Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
      await ThresholdsApi.createVersion(body);
      pushToast(`New version of ${form.profileKey} created; previous version auto-disabled.`, "success");
      setFormOpen(false);
      load();
    } catch (err) {
      pushApiError(err, "Could not create the new version.");
    } finally {
      setSaving(false);
    }
  };

  const pickProfileForForm = (key) => {
    const g = groups.find((x) => x.key === key);
    const latest = g?.versions[0];
    setForm((f) => ({
      ...f,
      profileKey: key,
      warning: latest?.warning ?? "",
      critical: latest?.critical ?? "",
      sourceRef: latest?.sourceRef || "",
      sourceDate: latest?.sourceDate ? latest.sourceDate.slice(0, 10) : "",
    }));
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Governance" scriptWord="Limit" title="thresholds" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !profiles) {
    return (
      <>
        <PageHeader eyebrow="Governance" scriptWord="Limit" title="thresholds" />
        <StatePanel title="Thresholds unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        scriptWord="Limit"
        title="thresholds"
        lede="Versioned limit profiles — the rule engine always uses the highest enabled version. Creating a version auto-disables the old one and audit-logs the change."
        right={
          canManage ? (
            <button className="btn btn-primary btn-sm" onClick={() => { setFormOpen((v) => !v); if (groups[0] && !form.profileKey) pickProfileForForm(groups[0].key); }}>
              <IconPlus size={13} /> New version
            </button>
          ) : null
        }
      />

      <Notice kind="warn" title="Statutory verification notice">
        Thresholds here are labelled <span className="mono-src">“verified via secondary source — cross-check pending”</span>.
        Warning levels marked <span className="pill sim">demo</span> are ~85% toward the limit for
        research. Cross-check every value against the current CMR 2017 text and DGMS circulars
        before any operational use.
      </Notice>

      {!canManage ? (
        <Notice kind="" title="Read-only access">
          Managing threshold versions needs the Ventilation Officer role or above. You can inspect
          every version and its provenance below.
        </Notice>
      ) : null}

      {formOpen && canManage ? (
        <div className="card" style={{ marginBottom: 18, borderColor: "var(--interactive-dim)" }}>
          <div className="card-head">
            <span className="eyebrow">Create new profile version</span>
          </div>
          <form onSubmit={createVersion}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="th-key">Profile</label>
                <select id="th-key" value={form.profileKey} onChange={(e) => pickProfileForForm(e.target.value)} required>
                  <option value="">Select…</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.key} — {paramLabel(g.versions[0].parameter)} · {locationLabel(g.versions[0].locationType)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="th-warn">Warning level <span className="unit-tag">leave blank if n/a</span></label>
                <input id="th-warn" type="number" step="any" value={form.warning} onChange={(e) => setForm({ ...form, warning: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="th-crit">Critical level <span className="unit-tag">leave blank if n/a</span></label>
                <input id="th-crit" type="number" step="any" value={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="th-src">Source reference</label>
                <input id="th-src" type="text" value={form.sourceRef} onChange={(e) => setForm({ ...form, sourceRef: e.target.value })} placeholder="e.g. CMR 2017 Reg. 153(2)(c)" />
              </div>
              <div className="field">
                <label htmlFor="th-date">Source date</label>
                <input id="th-date" type="date" value={form.sourceDate} onChange={(e) => setForm({ ...form, sourceDate: e.target.value })} style={{ fontFamily: "var(--mono)" }} />
              </div>
              <div className="field">
                <label htmlFor="th-note">Verification note</label>
                <input id="th-note" type="text" value={form.verificationNote} onChange={(e) => setForm({ ...form, verificationNote: e.target.value })} />
              </div>
            </div>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={saving || !form.profileKey}>
                {saving ? "Saving…" : "Publish new version"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            </div>
            <p className="hint" style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10 }}>
              Unit, comparator and rule type are inherited from the profile's latest version. The
              previous enabled version is disabled automatically.
            </p>
          </form>
        </div>
      ) : null}

      {groups.map((g) => {
        const head = g.versions[0];
        return (
          <details className="collapsible" key={g.key} open={g.versions.some((v) => v.enabled)}>
            <summary>
              <span className="mono" style={{ color: "var(--text)" }}>{g.key}</span>
              <span style={{ color: "var(--text-3)", fontWeight: 500, fontSize: 12.5 }}>
                {paramLabel(head.parameter)} · {locationLabel(head.locationType)} · {head.ruleType}
              </span>
              {head.enabled ? <StatusPill status="ONLINE" customLabel={`v${head.version} in force`} /> : <StatusPill status="OFFLINE" customLabel="no version in force" />}
            </summary>
            <div className="body">
              <div className="table-wrap" style={{ border: "none" }}>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Ver</th>
                      <th className="num">Warning</th>
                      <th className="num">Critical</th>
                      <th>Unit</th>
                      <th>Comparator</th>
                      <th>Source</th>
                      <th>Source date</th>
                      <th>Type</th>
                      <th>Status</th>
                      {canManage ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {g.versions.map((p) => (
                      <tr key={`${p.profileKey}-v${p.version}`} style={p.enabled ? {} : { opacity: 0.62 }}>
                        <td className="mono" style={{ fontWeight: 700 }}>v{p.version}</td>
                        <td className="num mono">{p.warning != null ? p.warning : "—"}</td>
                        <td className="num mono">{p.critical != null ? p.critical : "—"}</td>
                        <td className="mono">{p.unit || "—"}</td>
                        <td className="mono">{p.comparator || "—"}</td>
                        <td style={{ fontSize: 12.5, maxWidth: 260 }}>{p.sourceRef || "—"}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{p.sourceDate ? fmtDateIST(p.sourceDate) : "—"}</td>
                        <td><SourceTypeBadge t={p.sourceType} /></td>
                        <td>
                          {p.enabled ? <StatusPill status="ONLINE" customLabel="Enabled" /> : <StatusPill status="OFFLINE" customLabel="Disabled" />}
                        </td>
                        {canManage ? (
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => toggleEnabled(p)}
                              title={p.enabled ? "Disable this version" : "Enable this version"}
                            >
                              {p.enabled ? "Disable" : "Enable"}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {head.ruleType === "compound" && head.condition ? (
                <div className="mono" style={{ fontSize: 12, color: "var(--text-2)", marginTop: 10 }}>
                  Compound condition: triggers above {head.condition.triggerAbove} {head.condition.unit} when{" "}
                  {paramLabel(head.condition.requiresParam)} &lt; {head.condition.min}{" "}
                  {head.condition.minUnit || head.condition.unit}
                </div>
              ) : null}
              {head.verificationNote ? (
                <div style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 8 }}>
                  Verification: {head.verificationNote}
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </>
  );
}

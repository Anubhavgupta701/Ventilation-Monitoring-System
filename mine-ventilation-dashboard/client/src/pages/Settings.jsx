import React, { useCallback, useEffect, useState } from "react";
import { Settings as SettingsApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ui/toast";
import { LoadingPanel, Notice, PageHeader, StatePanel } from "../ui/primitives";
import { fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

const FIELDS = [
  { key: "mineName", label: "Mine name", type: "text", hint: "Shown in headers and reports." },
  { key: "tickMs", label: "Simulation tick (ms)", type: "number", min: 500, max: 30000, step: 500, hint: "How often the engine advances. Faster ticks = smoother particles, more history." },
  { key: "persons", label: "Persons underground (shift)", type: "number", min: 0, step: 1, hint: "Feeds the statutory air-quantity calculation." },
  { key: "dailyProductionTonnes", label: "Daily production (tonnes)", type: "number", min: 0, step: 1, hint: "Feeds the statutory air-quantity calculation." },
  { key: "retentionDays", label: "Data retention (days)", type: "number", min: 1, max: 3650, step: 1, hint: "How long readings are kept before expiry." },
];

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const canEdit = hasRole("Officer");

  const load = useCallback(async () => {
    try {
      const d = await SettingsApi.get();
      setSettings(d);
      setForm(d || {});
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(e);
      if (loading) pushApiError(e, "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    const payload = {};
    FIELDS.forEach((f) => {
      const raw = form[f.key];
      payload[f.key] = f.type === "number" ? Number(raw) : String(raw ?? "");
    });
    setSaving(true);
    try {
      const d = await SettingsApi.update(payload);
      setSettings(d);
      setForm(d || {});
      setDirty(false);
      pushToast("Settings saved — the simulator picks them up live.", "success");
    } catch (e) {
      pushApiError(e, "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Administration" scriptWord="System" title="settings" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !settings) {
    return (
      <>
        <PageHeader eyebrow="Administration" scriptWord="System" title="settings" />
        <StatePanel title="Settings unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        scriptWord="System"
        title="settings"
        lede="Engine parameters and mine profile. Changes apply live and are written to the audit trail. Editing needs the Officer role or above."
      />

      {!canEdit ? (
        <Notice kind="warn" title="Read-only role">
          You can view the settings, but saving needs the Officer role or above.
        </Notice>
      ) : null}

      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-head">
          <span className="eyebrow">Engine & mine configuration</span>
        </div>
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`set-${f.key}`}>{f.label}</label>
            <input
              id={`set-${f.key}`}
              type={f.type}
              min={f.min}
              max={f.max}
              step={f.step}
              value={form[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              disabled={!canEdit || saving}
            />
            <div className="hint">
              {f.hint}
              {f.type === "number" && form[f.key] !== "" && form[f.key] != null
                ? <> Current stored value: <span className="mono">{fmtNum(Number(form[f.key]), 0)}</span>.</>
                : null}
            </div>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={!canEdit || !dirty || saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button className="btn btn-ghost" onClick={load} disabled={saving}>
            Reload
          </button>
        </div>
      </div>
    </>
  );
}

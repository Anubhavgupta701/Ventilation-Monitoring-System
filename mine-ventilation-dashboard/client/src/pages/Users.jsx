import React, { useCallback, useEffect, useState } from "react";
import { Users as UsersApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ui/toast";
import { LoadingPanel, Notice, PageHeader, StatePanel } from "../ui/primitives";
import { IconInfo, IconPlus } from "../ui/icons";

const ROLES = ["Viewer", "Operator", "Ventilation Officer", "Admin"];

export default function UsersPage() {
  const { user: me } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: "", password: "", role: "Viewer" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await UsersApi.list();
      setUsers(Array.isArray(d) ? d : d?.data || []);
      setError(null);
    } catch (err) {
      setError(err);
      if (loading) pushApiError(err, "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await UsersApi.create(form);
      pushToast(`User ${form.username} created.`, "success");
      setForm({ username: "", password: "", role: "Viewer" });
      load();
    } catch (err) {
      pushApiError(err, "Could not create user.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await UsersApi.setActive(u.username, !u.active);
      pushToast(`User ${u.username} ${u.active ? "deactivated" : "activated"}.`, "success");
      load();
    } catch (err) {
      pushApiError(err, "Could not change user status.");
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Administration" scriptWord="User" title="management" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !users) {
    return (
      <>
        <PageHeader eyebrow="Administration" scriptWord="User" title="management" />
        <StatePanel title="Users unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        scriptWord="User"
        title="management"
        lede="Accounts and roles. The server refuses to deactivate your own account or the last admin — those buttons stay guarded here too."
      />

      <Notice kind="" title="Role ladder">
        <span className="mono">Viewer</span> reads · <span className="mono">Operator</span> acknowledges
        alerts + exports · <span className="mono">Ventilation Officer</span> manages sensors,
        branches, thresholds + triggers simulator scenarios · <span className="mono">Admin</span> manages users.
      </Notice>

      <div className="grid-2">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => {
                const isSelf = u.username === me?.username;
                return (
                  <tr key={u.username}>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {u.username}
                      {isSelf ? <span style={{ color: "var(--text-3)", fontWeight: 400 }}> (you)</span> : null}
                    </td>
                    <td>{u.role}</td>
                    <td>
                      {u.active ? (
                        <span className="pill ok">Active</span>
                      ) : (
                        <span className="pill off">Inactive</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleActive(u)}
                        disabled={isSelf}
                        title={isSelf ? "You cannot deactivate your own account" : ""}
                      >
                        {u.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Create user</span>
          </div>
          <form onSubmit={create}>
            <div className="field">
              <label htmlFor="u-name">Username</label>
              <input
                id="u-name"
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="u-pass">Password</label>
              <input
                id="u-pass"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="new-password"
              />
              <span className="hint">Set via the admin console — the password is never displayed again.</span>
            </div>
            <div className="field">
              <label htmlFor="u-role">Role</label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <IconPlus size={13} /> {saving ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

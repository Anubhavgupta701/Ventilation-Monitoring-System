import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Auth, setAuthToken } from "../lib/api";

/* JWT is stored in memory only — never localStorage. Refresh = re-login. */
const AuthContext = createContext(null);

/* Backend roles are lowercase (seed: viewer/operator/officer/admin).
   hasRole normalises the requested minimum too, so call sites can keep
   using the display names ("Operator", "Ventilation Officer"). */
const ROLE_RANK = { viewer: 1, operator: 2, officer: 3, admin: 4 };
const ROLE_ALIAS = { "ventilation officer": "officer" };
const rankOf = (r) => {
  const key = String(r || "").toLowerCase();
  return ROLE_RANK[ROLE_ALIAS[key] || key] || 0;
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const login = useCallback(async (username, password) => {
    setBusy(true);
    try {
      const res = await Auth.login(username.trim(), password);
      setAuthToken(res.accessToken);
      setToken(res.accessToken);
      setUser(res.user);
      return res.user;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await Auth.logout();
    } catch {
      /* token may already be dead — clear locally regardless */
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const hasRole = useCallback(
    (minRole) => {
      if (!user) return false;
      return rankOf(user.role) >= rankOf(minRole);
    },
    [user]
  );

  const value = useMemo(
    () => ({ token, user, busy, login, logout, clearSession, hasRole, isAuthed: !!token }),
    [token, user, busy, login, logout, clearSession, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

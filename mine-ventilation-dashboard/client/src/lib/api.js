/* API client — REST base /api/v1 (proxied to :4001 in dev).
   JWT lives in memory only; this module holds the in-memory token. */

let authToken = null;
export const setAuthToken = (t) => {
  authToken = t;
};

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function buildUrl(path, query) {
  let url = `/api/v1${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

export async function api(path, { method = "GET", body, query } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the API server. Check that the backend is running on :4001.",
      null,
      null
    );
  }

  if (res.status === 204) return null;

  const ct = res.headers.get("content-type") || "";
  let data = null;
  try {
    data = ct.includes("json") ? await res.json() : await res.text();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && authToken) {
      /* Token died server-side: drop it locally and tell the app to re-login.
         Guarded on authToken so the login form's own 401 never triggers this. */
      setAuthToken(null);
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    const env = data && typeof data === "object" ? data : {};
    throw new ApiError(
      res.status,
      env.code || `HTTP_${res.status}`,
      env.message || `Request failed with status ${res.status}`,
      env.details || null,
      env.requestId || null
    );
  }
  return data;
}

/* Blob download — fetch as blob so the in-memory token can travel
   in the Authorization header (no plain <a href> possible). */
export async function downloadBlob(path, query, filename) {
  const headers = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  let res;
  try {
    res = await fetch(buildUrl(path, query), { headers });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the API server.", null, null);
  }
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    let env = {};
    try {
      env = ct.includes("json") ? await res.json() : {};
    } catch {
      env = {};
    }
    throw new ApiError(
      res.status,
      env.code || `HTTP_${res.status}`,
      env.message || `Download failed with status ${res.status}`,
      env.details || null,
      env.requestId || null
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
export const downloadCsv = downloadBlob; // alias kept for existing call sites

/* ---- endpoint helpers ---- */
export const Auth = {
  login: (username, password) => api("/auth/login", { method: "POST", body: { username, password } }),
  me: () => api("/auth/me"),
  logout: () => api("/auth/logout", { method: "POST" }),
};

export const Overview = { get: () => api("/overview") };

export const Sensors = {
  list: (query) => api("/sensors", { query }),
  get: (id) => api(`/sensors/${id}`),
  readings: (id, { range = "1h", to, parameter } = {}) =>
    api(`/sensors/${id}/readings`, { query: { range, to, parameter } }),
};

export const Branches = { list: () => api("/branches") };
export const Districts = { list: () => api("/districts") };

export const History = {
  /* GET /history/multi?sensorIds&params&from&to&buckets=200 */
  multi: (query) => api("/history/multi", { query }),
};

export const Alerts = {
  list: (query) => api("/alerts", { query }),
  acknowledge: (id, note) => api(`/alerts/${id}/acknowledge`, { method: "POST", body: note ? { note } : {} }),
};

export const Thresholds = {
  list: () => api("/thresholds"),
  createVersion: (payload) => api("/thresholds", { method: "POST", body: payload }),
  setEnabled: (profileKey, enabled) =>
    api(`/thresholds/${encodeURIComponent(profileKey)}/enabled`, { method: "PATCH", body: { enabled } }),
};

export const Calculations = {
  ventilation: (inputs) => api("/calculations/ventilation", { method: "POST", body: inputs }),
};

export const Users = {
  list: () => api("/users"),
  create: (payload) => api("/users", { method: "POST", body: payload }),
  setActive: (username, active) =>
    api(`/users/${encodeURIComponent(username)}/active`, { method: "PATCH", body: { active } }),
};

/* ---- v2: control equipment ---- */
export const Fans = {
  list: () => api("/fans"),
  start: (id) => api(`/fans/${id}/start`, { method: "POST" }),
  stop: (id) => api(`/fans/${id}/stop`, { method: "POST" }),
  setRpm: (id, rpm) => api(`/fans/${id}/rpm`, { method: "POST", body: { rpm } }),
  setAuto: (id, enabled) => api(`/fans/${id}/auto`, { method: "POST", body: { enabled } }),
};

export const Doors = {
  list: () => api("/doors"),
  open: (id) => api(`/doors/${id}/open`, { method: "POST" }),
  close: (id) => api(`/doors/${id}/close`, { method: "POST" }),
};

export const Regulators = {
  list: () => api("/regulators"),
  setOpening: (id, openingPct) => api(`/regulators/${id}/opening`, { method: "POST", body: { openingPct } }),
  nudge: (id, delta) => api(`/regulators/${id}/opening`, { method: "POST", body: { delta } }),
};

/* ---- v2: simulator ---- */
export const Simulator = {
  status: () => api("/simulator/status"),
  pause: () => api("/simulator/pause", { method: "POST" }),
  resume: () => api("/simulator/resume", { method: "POST" }),
  reset: () => api("/simulator/reset", { method: "POST" }),
  setSpeed: (speed) => api("/simulator/speed", { method: "POST", body: { speed } }),
  faults: () => api("/simulator/faults"),
  injectFault: (faultId, targetId) =>
    api("/simulator/faults", { method: "POST", body: targetId ? { faultId, targetId } : { faultId } }),
  recoverFault: (faultId) => api(`/simulator/faults/${faultId}/recover`, { method: "POST" }),
  recoverAllFaults: () => api("/simulator/faults/recover-all", { method: "POST" }),
  scenarios: () => api("/simulator/scenarios"),
  runScenario: (id) => api(`/simulator/scenarios/${id}/run`, { method: "POST" }),
  snapshots: (query) => api("/simulator/snapshots", { query }),
  snapshotAt: (at) => api("/simulator/snapshot", { query: { at } }),
};

/* ---- v2: governance ---- */
export const Audit = {
  list: (query) => api("/audit", { query }),
};

export const Settings = {
  get: () => api("/settings"),
  update: (payload) => api("/settings", { method: "PATCH", body: payload }),
};

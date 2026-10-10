/* Formatting helpers — IST display, ages, units, parameter metadata. */

const istDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const istDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const istTimeSec = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export const fmtDateIST = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : istDate.format(d);
};
export const fmtDateTimeIST = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${istDateTime.format(d)} IST`;
};
export const fmtTimeIST = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : istTime.format(d);
};
export const fmtTimeSecIST = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : istTimeSec.format(d);
};

/** Duration clock for sim time given in seconds: "05:30:00". */
export function fmtDurationHMS(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return "—";
  const s = Math.max(0, Math.floor(Number(sec)));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

/** Human age: "4 s", "2 min", "3 h", "5 d". Returns null when ts is falsy. */
export function ageOf(ts, now = Date.now()) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function ageClass(ageSec) {
  if (ageSec == null) return "";
  if (ageSec > 30) return "stale-age";
  return "";
}

export const fmtNum = (v, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toFixed(digits);
};

/* Canonical parameter metadata — units per API_CONTRACT §0. */
export const PARAM_META = {
  airflow: { label: "Airflow", unit: "m³/min", digits: 1 },
  velocity: { label: "Velocity", unit: "m/s", digits: 2 },
  ch4: { label: "CH₄", unit: "%vol", digits: 3 },
  co2: { label: "CO₂", unit: "%vol", digits: 3 },
  co: { label: "CO", unit: "ppm", digits: 1 },
  o2: { label: "O₂", unit: "%vol", digits: 2 },
  temp: { label: "Dry-bulb temp", unit: "°C", digits: 1 },
  wetBulb: { label: "Wet-bulb temp", unit: "°C", digits: 1 },
  humidity: { label: "Rel. humidity", unit: "%", digits: 1 },
  pressure: { label: "Static pressure", unit: "Pa", digits: 0 },
  dust: { label: "Respirable dust", unit: "mg/m³", digits: 2 },
  fanRpm: { label: "Fan speed", unit: "rpm", digits: 0 },
};

export const paramLabel = (p) => PARAM_META[p]?.label || p;
export const paramUnit = (p) => PARAM_META[p]?.unit || "";
export const paramDigits = (p) => PARAM_META[p]?.digits ?? 2;

export const fmtParamValue = (p, v) => {
  if (v === null || v === undefined) return "—";
  return `${fmtNum(v, paramDigits(p))}`;
};

/* Order parameters for display: gases first, then climate, then flow. */
export const PARAM_ORDER = [
  "ch4",
  "co",
  "co2",
  "o2",
  "wetBulb",
  "temp",
  "humidity",
  "dust",
  "airflow",
  "velocity",
  "pressure",
  "fanRpm",
];
export const sortParams = (params = []) =>
  [...params].sort((a, b) => {
    const ia = PARAM_ORDER.indexOf(a);
    const ib = PARAM_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

export const LOCATION_LABELS = {
  INTAKE: "Intake airway",
  LAST_VENTILATION_CONNECTION: "Last ventilation connection",
  DISTRICT_RETURN_GENERAL_BODY: "District return — general body",
  WORKING_PLACE: "Working place",
  MAIN_RETURN: "Main return",
  FAN_DRIFT: "Fan drift",
  FAN_HOUSE: "Fan house",
  ANY_PLACE: "Any place",
};
export const locationLabel = (lt) => LOCATION_LABELS[lt] || lt || "—";

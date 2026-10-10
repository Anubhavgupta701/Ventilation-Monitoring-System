# Mine Ventilation Monitoring Dashboard

An academic / IoT-ready research prototype for monitoring underground mine
ventilation — airflow, velocity, gases (CH₄ / CO₂ / CO / O₂), temperatures,
humidity, pressure and fan status — with Indian regulatory logic
(CMR 2017 Reg. 153, DGMS 2025 circulars).

> **Academic prototype — not a certified mine-safety system.**
> Verify statutory requirements before operational use.

## Architecture

```
┌──────────────┐      ┌──────────────────────────┐      ┌───────────┐
│ React client │◄────►│  Node/Express API :4001  │◄────►│  MongoDB  │
│     :5174    │ REST │  Socket.IO /realtime     │      │  :27017   │
└──────────────┘      │  in-process simulator    │      │ minevent  │
                      │  rule engine (pure JS)   │      └───────────┘
                      │  stale sweeper           │
                      └──────────────────────────┘
```

- `server/` — Express 4 + Socket.IO 4 + Mongoose 8 API (CommonJS).
- `client/` — React frontend (built separately).
- `docs/API_CONTRACT.md` — the frozen API contract both sides implement.

## Quick start

```bash
npm run install:all   # install root + server deps (client installed separately)
npm run seed          # idempotent seed (needs MongoDB — see below)
npm run dev           # starts local MongoDB + API with auto-reload
```

Server scripts (`npm --prefix server run …`):

| script | what it does |
|---|---|
| `mongo` | starts a persistent local `mongod` (`server/.mongodata`, reuses 27017 if already serving) |
| `seed`  | clears and reseeds users / sensors / branches / districts / threshold profiles |
| `dev`   | `nodemon src/index.js` — API with auto-reload |
| `start` | `node src/index.js` — production-style start |
| `test`  | `node --test tests/*.test.js` — rule-engine + calculator unit tests |

### Ports

- API: `http://localhost:4001` (`process.env.PORT` overrides)
- Client: `http://localhost:5174`
- MongoDB: `127.0.0.1:27017/minevent` (persistent `server/.mongodata/`)

### Environment

| var | default | purpose |
|---|---|---|
| `MONGO_URI` | `mongodb://127.0.0.1:27017/minevent` | MongoDB connection (point at Atlas to override) |
| `JWT_SECRET` | `dev-secret-change-me` (with console warning) | JWT signing — **set a real secret outside dev** |
| `PORT` | `4001` | API listen port |
| `CORS_ORIGIN` | `http://localhost:5174` | allowed browser origin |

A template lives at `server/.env.example`.

### Demo logins (seeded)

| username | password | role |
|---|---|---|
| `admin` | `admin123` | Admin — everything incl. user management |
| `ventoff` | `ventoff123` | Ventilation Officer — CRUD + thresholds + simulator |
| `operator` | `op123` | Operator — acknowledge alerts + CSV exports |
| `viewer` | `view123` | Viewer — read-only |

> **Change these passwords before any shared/demo deployment** — they are
> public demo credentials. Admins can manage users at `GET/PATCH /api/v1/users`.

Roles are enforced server-side on every route:
Viewer = read-only · Operator = + alert ack & CSV ·
Ventilation Officer = + sensors/branches/districts CRUD, threshold versions, simulator scenarios ·
Admin = + user management.

## API overview (`/api/v1`)

Auth: `Authorization: Bearer <jwt>` (~4 h expiry, single short-lived token, no
refresh). Socket.IO namespace `/realtime` authenticates via handshake
`auth: { token }`. All errors use the envelope
`{ code, message, details, requestId }`; paged lists return `{ data, page, limit, total }`.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{username,password}` → `{accessToken, expiresIn:14400, user}` |
| GET | `/auth/me` | any | current user |
| POST | `/auth/logout` | any | → 204 (client discards token) |
| GET | `/healthz` | public | `{status, mongo, simulator, serverTime, version}` |
| GET | `/overview` | any | 10 worst-case KPIs, sensor statuses, active alerts, `overallStatus` |
| GET/POST | `/sensors` | any / officer+ | paged list; create |
| GET/PATCH | `/sensors/:id` | any / officer+ | sensor + latest reading + active alerts; patch is audit-logged |
| GET | `/sensors/:id/readings?range=1h\|6h\|24h\|7d` | any | decimated to ≤300 buckets, gaps preserved as `null` |
| GET/POST | `/branches` | any / officer+ | SVG geometry (`0 0 1000 600`) |
| GET/PATCH | `/branches/:id` | any / officer+ | branch + sensors on it |
| GET/POST | `/districts` | any / officer+ | |
| PATCH | `/districts/:id` | officer+ | |
| GET | `/alerts?status=&severity=&sensorId=` | any | newest first, paged |
| POST | `/alerts/:id/acknowledge` | operator+ | `{note?}` → ACKNOWLEDGED + history |
| GET/POST | `/thresholds` | any / officer+ | versioned profiles; POST creates a new version (auto-disables old) |
| PATCH | `/thresholds/:profileKey/enabled` | officer+ | cannot disable the last enabled version; emits `config:changed` |
| POST | `/calculations/ventilation` | any | air-quantity + heat-rule calc with working steps |
| GET | `/reports/readings.csv?sensorId=&from=&to=` | operator+ | CSV with units, `generatedAt`, safety notice |
| GET | `/reports/alerts.csv?from=&to=` | operator+ | same CSV rules |
| GET/POST | `/users` | admin | list/create (no password hashes returned) |
| PATCH | `/users/:username/active` | admin | cannot deactivate self or the last admin |
| POST | `/simulator/scenarios` | officer+ | `{scenario, targetSensorId?}` — runs ~5 min, auto-reverts to normal |
| GET | `/simulator/status` | any | current scenario |

### Simulator scenarios

`normal` (default) · `rising CH4` (S4/S6 CH₄ climbs through warning → critical) ·
`fan stop` (fan RPM → 0, chain airflow/velocity/pressure collapse) ·
`sensor dropout` (target stops → STALE after 9 s, OFFLINE after 30 s) ·
`stuck value` (target repeats identical values, quality `STUCK`) ·
`spike` (brief CH₄ spike crossing critical, then recovers).

One reading per sensor every ~3 s from a seeded RNG (mulberry32, seed 42 —
reseeded on every scenario change, so runs are reproducible). Velocity is
derived as `v = Q/60/A` at flow sensors. Every reading is stamped
server-side `origin: "simulated"`.

### Socket.IO (`/realtime`, server → client only)

`reading:update` · `sensor:status` · `alert:created` / `alert:updated` /
`alert:resolved` · `system:status` · `config:changed`.

## Rule engine & alerts

- Pure module `server/src/rules/engine.js` (no DB imports) — unit-tested with
  `node:test`. MAX breaches when value is *strictly* above the limit
  (boundaries 19.0 O₂ / 0.5 CO₂ / 33.5 wet-bulb are compliant with the
  statutory limit); MIN breaches when *strictly* below.
- Compound heat rule: wet-bulb **strictly > 30.5 °C** AND velocity **< 1.0 m/s**
  → CRITICAL.
- Air-quantity rule reads factors from the enabled `TP-AIRQTY-FACTORS`
  profile (`{perPerson: 6, perTonne: 2.5}`) — the numbers 6/2.5 appear nowhere
  in the engine or calculator code: `Q_required = max(6·persons, 2.5·tonnes)`
  evaluated at the district's last-ventilation-connection sensor.
- Alert lifecycle `ACTIVE → ACKNOWLEDGED → RESOLVED`; one open alert per
  `{sensorId, parameter, type}` (partial unique index); WARNING→CRITICAL
  escalation resets acknowledgement; auto-resolve after 3 consecutive normal
  readings with a 5 % deadband. Stale sensors never resolve gas alerts.
- Stale sweeper (every 2 s): `STALE` after 9 s, `OFFLINE` after 30 s without a
  reading; raises `STALE_COMMS` alerts; `overview.overallStatus = DEGRADED`
  while any safety-critical sensor is STALE/OFFLINE.

## Deviations from the design docs

These are deliberate simplifications versus the original design documents:

1. **Auth**: single short-lived JWT (~4 h), no refresh-token rotation.
2. **Roles**: 4 roles (Viewer / Operator / Ventilation Officer / Admin).
3. **Simulator**: in-process (not a separate service); scenario auto-revert timer
   is in-memory (a server restart clears the active scenario).
4. **Reports**: CSV only (no PDF export).
5. **Users**: no invite/onboarding flow — admin creates users directly with a password.
6. **Root scripts**: `npm run dev` starts MongoDB + API + client (ports 27017 / 4001 / 5174); `install:all` covers root + server + client.
7. **Readings buckets** include a `quality` field alongside `values` (additive).
8. **Overview** additionally returns `alertSummary` counts next to `activeAlerts`.
9. `GET /simulator/status` added (not in the contract) for UI state display.
10. Readings carry a single **unique** compound index on `{sensorId, measuredAt}`
    (the contract lists a second identical non-unique index; the unique one
    already serves the prefix range queries, and Mongoose warns on duplicates).

## Safety note

All telemetry is **simulated**. Threshold verification notes are marked
"verified via secondary source — cross-check pending". This is an academic
prototype — **not a certified mine-safety system**. Verify statutory
requirements before operational use.

# API Contract + Data Model — Mine Ventilation Monitoring Dashboard
**Version: v1 (frozen for this build).** Both builders (backend + frontend) must implement exactly this. REST base: `/api/v1`. Socket.IO namespace: `/realtime`.

## 0. Conventions
- **Ports:** API `http://localhost:4001`, client `http://localhost:5174`. MongoDB local at `127.0.0.1:27017/minevent` (persistent `.mongodata/`), `MONGO_URI` env override for Atlas.
- **Canonical units (stored):** airflow `m³/min`, velocity `m/s`, CH₄/CO₂/O₂ `%vol`, CO `ppm`, temperatures `°C`, RH `%`, pressure `Pa`, dust `mg/m³`, fan speed `rpm`. Every API value carries a `unit` field; every UI value shows its unit.
- **Time:** store UTC ISO-8601; display Asia/Kolkata (IST).
- **Error envelope (all 4xx/5xx):** `{ "code": "SNAKE_CODE", "message": "human text", "details": {}, "requestId": "<uuid>" }`.
- **Pagination:** `?page=1&limit=50` → `{ "data": [...], "page": 1, "limit": 50, "total": n }`.
- **Auth:** JWT bearer `Authorization: Bearer <token>`, single short-lived access token (~4h). Socket.IO handshake: `auth: { token }`.
- **Seed login:** `admin / admin123` (Admin). Also seeded demo users: `ventoff / ventoff123` (Ventilation Officer), `operator / op123` (Operator), `viewer / view123` (Viewer).
- **Roles & permissions (server-enforced; UI hides too):**
  - Viewer: read overview, sensors, map, alerts, analytics, calculator, thresholds, reports page; no export, no ack.
  - Operator: Viewer + `POST /alerts/:id/acknowledge` + CSV report downloads.
  - Ventilation Officer: Operator + sensors/branches/districts CRUD + threshold profiles (new version / enable-disable) + simulator scenario injection.
  - Admin: everything + user management (`/users` list/create/deactivate).

## 1. MongoDB collections
- **users** — `{ username (unique), passwordHash, role, active, createdAt }`
- **sensors** — `{ sensorId (unique, e.g. "S1"), name, locationType (enum), branchId, districtId, type, status: ONLINE|STALE|OFFLINE, expectedIntervalSec: 3, safetyCritical: true, parameters: [names], calibrationDate, origin: "simulated", mapPosition: {x,y} }`
- **branches** — `{ branchId (unique), name, fromNode, toNode, area (m²), direction: INTAKE|RETURN, path: [{x,y}…] in 0–1000 SVG space, isLastVentilationConnection: bool, districtId }`
- **districts** — `{ districtId (unique), name, personsLargestShift, dailyOutputTonnes, lastConnectionBranchId }`
- **readings** — `{ sensorId, measuredAt (Date, UTC), receivedAt, origin: "simulated", values: { airflow, velocity, ch4, co2, co, o2, temp, wetBulb, humidity, pressure, dust, fanRpm } (only fields the sensor measures; missing = absent), derived: [{parameter, expression}], quality: NORMAL|DROPOUT|STUCK|SPIKE }` · unique index `{sensorId, measuredAt}` · index `{sensorId, measuredAt}` for range queries.
- **thresholdProfiles** — `{ profileKey (e.g. "TP-CH4-RETURN-ANY"), version, parameter, locationType, comparator: MAX|MIN, warning, critical, unit, ruleType: "limit"|"compound", condition: { triggerAbove, requiresParam, min, unit } (compound only), sourceType: "STATUTORY"|"DEMO"|"MINE_PLAN", warningSourceType: "STATUTORY"|"DEMO"|"MINE_PLAN" (provenance of the warning level; seed warnings are DEMO defaults ~85% toward the limit), sourceRef, sourceDate, verificationNote, enabled }` · unique `{profileKey, version}`; rule selection = enabled profile matching `{parameter, locationType}`, highest version.
- **alerts** — `{ alertId, sensorId, parameter, type: LIMIT|COMPOUND|STALE_COMMS, origin, severity: CRITICAL|WARNING, status: ACTIVE|ACKNOWLEDGED|RESOLVED, openedAt, lastSeenAt, triggerValue, peakValue, thresholdSnapshot {warning, critical, unit, comparator, sourceRef, sourceDate, profileKey, version}, acknowledgedBy, acknowledgedAt, ackNote, resolvedAt, resolution, history: [{ts, action, by, note}] }` · partial unique `{sensorId, parameter, type}` where status ∈ {ACTIVE, ACKNOWLEDGED}.
- **auditLogs** — `{ ts, actor, action, entityType, entityId, before, after, requestId }`

## 2. Seed data (backend `npm run seed`, idempotent)
### 2a. Sensors (8 virtual, `expectedIntervalSec: 3`, `safetyCritical: true`, `origin: "simulated"`)
| id | name | locationType | parameters |
|---|---|---|---|
| S1 | Intake Air Station | INTAKE | airflow, velocity, pressure, temp, wetBulb, humidity |
| S2 | District Intake Monitor | INTAKE | airflow, velocity, pressure |
| S3 | Last Ventilation Connection | LAST_VENTILATION_CONNECTION | airflow, velocity, temp, wetBulb, humidity |
| S4 | District Return Gas Monitor | DISTRICT_RETURN_GENERAL_BODY | ch4, co2, co, o2, velocity, temp, wetBulb, humidity |
| S5 | Working Place Climate Monitor | WORKING_PLACE | ch4, co2, co, o2, temp, wetBulb, humidity, dust |
| S6 | Main Return Gas Monitor | MAIN_RETURN | ch4, co2, o2, pressure, airflow, velocity |
| S7 | Fan Drift Pressure Station | FAN_DRIFT | pressure, airflow, velocity, fanRpm |
| S8 | Fan House Monitor | FAN_HOUSE | fanRpm, temp, pressure |

### 2b. Districts
- `D1` District A — personsLargestShift 120, dailyOutputTonnes 400, lastConnectionBranchId `B-LVC`
- `D2` District B — personsLargestShift 250, dailyOutputTonnes 300, lastConnectionBranchId `B-DRET`

### 2c. Branches (SVG viewBox `0 0 1000 600`)
- `B-INTAKE` "Main Intake Airway" INTAKE, (80,140)→(240,140), area 12, district D1
- `B-01` "Intake to District" INTAKE, (240,140)→(420,140), area 10, D1, sensor S1@ (150,140)… place S1 on B-INTAKE @ (160,140), S2 on B-01 @ (330,140)
- `B-LVC` "Last Ventilation Connection" INTAKE, (420,140)→(600,140), area 8, D1, `isLastVentilationConnection: true`, S3 @ (510,140)
- `B-DWORK` "District Working Airway" RETURN, (600,140)→(780,140), area 8, D2, S5 @ (690,140)
- `B-DRET` "District Return Airway" RETURN, (780,140)→(920,140), area 10, D2, S4 @ (850,140) — hmm district return gas monitor belongs on return; place S4 on B-DRET @ (850,140)
- `B-MAINRET` "Main Return Airway" RETURN, (920,140)→(960,140)? keep short — instead: (780,140)→(960,140) total via two segments; S6 on B-MAINRET @ (900,140)
- `B-FANDRIFT` "Fan Drift" RETURN, (780,140)→(780,340), area 6, D2, S7 @ (780,230)
- Fan house node `FAN` @ (780,340); S8 @ (780,300).
Branch fields: `{ branchId, name, fromNode: {label, x, y}, toNode: {label, x, y}, area, direction, path: [{x,y}], isLastVentilationConnection, districtId }`.

### 2d. Threshold profiles (seeded; `verificationNote`: "verified via secondary source — cross-check pending")
| profileKey | param | locationType | comp | warning | critical | unit | ruleType | sourceRef |
|---|---|---|---|---|---|---|---|---|
| TP-O2-GENERAL | o2 | ANY_PLACE | MIN | 19.5 (DEMO) | 19 | %vol | limit | CMR 2017 Reg. 153(2)(b) |
| TP-CO2-GENERAL | co2 | ANY_PLACE | MAX | 0.4 (DEMO) | 0.5 | %vol | limit | CMR 2017 Reg. 153(2)(b) |
| TP-CH4-DRET | ch4 | DISTRICT_RETURN_GENERAL_BODY | MAX | 0.6 (DEMO) | 0.75 | %vol | limit | CMR 2017 Reg. 153(2)(c) |
| TP-CH4-ANY | ch4 | ANY_PLACE | MAX | 1.0 (DEMO) | 1.25 | %vol | limit | CMR 2017 Reg. 153(2)(c) |
| TP-WB-GENERAL | wetBulb | WORKING_PLACE | MAX | 31.0 (DEMO) | 33.5 | °C | limit | CMR 2017 Reg. 153(2)(d) |
| TP-WB-VELOCITY | wetBulb | WORKING_PLACE | MAX | — | — | °C | compound | CMR 2017 Reg. 153(2)(d) — condition `{ triggerAbove: 30.5, requiresParam: "velocity", min: 1.0, unit: "m/s" }` |
| TP-AIRQTY-FACTORS | requiredAir | LAST_VENTILATION_CONNECTION | MIN | margin<10% (DEMO) | required | m³/min | limit | CMR 2017 Reg. 153(2)(a) — factors `{ perPerson: 6, perTonne: 2.5 }` stored on profile, NOT hard-coded |

**Boundary semantics (unit-tested):** 19.0 O₂ compliant; 0.5 CO₂ compliant; 33.5 wet-bulb compliant; wet-bulb 30.5 does NOT trigger the velocity rule (trigger is strictly > 30.5). Warning levels are DEMO (~85% toward limit), `sourceType: "DEMO"`, editable. No numbers hard-coded in the rule engine or calculator — factors 6 and 2.5 are read from `TP-AIRQTY-FACTORS`.

## 3. REST endpoints (`/api/v1`)
| Method | Path | Role | Body / query → response |
|---|---|---|---|
| POST | `/auth/login` | public | `{username, password}` → `{ accessToken, expiresIn: 14400, user: {username, role} }`; 401 `{code:"INVALID_CREDENTIALS"}` |
| GET | `/auth/me` | any | → `{ user: {username, role} }` |
| POST | `/auth/logout` | any | → 204 (client discards token) |
| GET | `/healthz` | public | → `{ status:"ok", mongo:"up", simulator:"running", serverTime, version:"1.0.0" }` |
| GET | `/overview` | any | → `{ serverTime, overallStatus: NORMAL\|DEGRADED, simulatedMode:true, sensors: [{sensorId, name, locationType, status, lastReading, lastSeenAt}], activeAlerts, kpis: [{label, value, unit, location, ageSec, severity}] }` (10 KPIs: max CH₄, min O₂, max CO₂, max CO, max wet-bulb, max dust, total airflow, min velocity, fan pressure, fan RPM — worst-case value + location + age each) |
| GET | `/sensors` | any | → paged sensors |
| POST | `/sensors` | officer+ | create (sensorId unique, immutable) → 201 |
| GET | `/sensors/:id` | any | → sensor + latestReading + activeAlerts |
| PATCH | `/sensors/:id` | officer+ | update fields; audit-logged |
| GET | `/sensors/:id/readings?range=1h\|6h\|24h\|7d` | any | server-side decimation to ≤ ~300 points; **gaps preserved as null** → `{ sensorId, range, parameter?, buckets: [{t, values:{…}|null}] }` |
| GET | `/branches` | any | → branches with geometry |
| POST | `/branches` | officer+ | → 201 |
| GET | `/branches/:id` | any | → branch + sensors on it |
| PATCH | `/branches/:id` | officer+ | → updated |
| GET | `/districts` | any | → districts |
| POST | `/districts` | officer+ | → 201 |
| PATCH | `/districts/:id` | officer+ | → updated |
| GET | `/alerts?status=&severity=&sensorId=` | any | → paged alerts (newest first) |
| POST | `/alerts/:id/acknowledge` | operator+ | `{ note? }` → updated alert (history appended) |
| GET | `/thresholds` | any | → all profiles (all versions, `enabled` flags) |
| POST | `/thresholds` | officer+ | new version of a profileKey (old disabled automatically, audit-logged) → 201 |
| PATCH | `/thresholds/:profileKey/enabled` | officer+ | `{ enabled }` (can't disable last enabled version) → updated; emits `config:changed` |
| POST | `/calculations/ventilation` | any | `{ persons, dailyOutputTonnes, area, measuredAirflow, wetBulb?, measuredVelocity? }` → `{ inputs, factors: {perPerson:6, perTonne:2.5, sourceRef}, steps: [{label, expr, result}], results: { qByPersons, qByOutput, qRequired, velocity, velocityRequired, complianceMargin, airQuantity: OK|SHORTFALL, heatRule: OK|VIOLATED|NOT_APPLICABLE, overall: COMPLIANT|NON_COMPLIANT } }` — v = Q/60/A; Q_required = max(6·persons, 2.5·tonnes); margin = (measured−required)/required |
| GET | `/reports/readings.csv?sensorId=&from=&to=` | operator+ | CSV with `sep=,` header, units column, `generatedAt`, safety notice |
| GET | `/reports/alerts.csv?from=&to=` | operator+ | same CSV rules |
| GET | `/users` | admin | → users (no hashes) |
| POST | `/users` | admin | `{ username, password, role }` → 201 |
| PATCH | `/users/:username/active` | admin | `{ active }` (can't deactivate self or last admin) |
| POST | `/simulator/scenarios` | officer+ | `{ scenario: "normal"\|"rising CH4"\|"fan stop"\|"sensor dropout"\|"stuck value"\|"spike", targetSensorId? }` → `{ scenario, startedAt }`; scenario runs ~5 min then auto-reverts to normal |

## 4. Simulator (in-process, Node)
- One reading per sensor every ~3 s (`expectedIntervalSec: 3`). Baselines + slow drift + noise; **seeded RNG** (mulberry32, seed 42) for reproducible test runs.
- Cross-parameter consistency: velocity derived from airflow/area at flow sensors (`v = Q/60/A`); fan-stop scenario drops S7/S8 fanRpm → 0 and airflow/velocity/pressure readings across the chain decay.
- Every reading stamped **server-side** `origin: "simulated"` (no client input can set origin).
- Scenarios: normal (default); rising CH₄ (S4/S6 ch4 climbs past warning → critical); fan stop (fanRpm→0, airflow collapses, S7 pressure collapses); sensor dropout (target stops sending → STALE after 9 s, OFFLINE after 30 s); stuck value (target repeats same values); spike (brief ch4 spike crossing critical, then recovers).
- Missing a tick = gap; readings API preserves gaps (null buckets).

## 5. Rule engine (pure functions, unit-tested with node:test)
- Input: `{ reading, sensor, enabledProfiles, district? }`. Output: array of breach descriptors `{ parameter, type: LIMIT|COMPOUND, severity, value, profileKey, version, thresholdSnapshot }`.
- MAX: breach if value > limit; WARNING if > warning. MIN: breach if value < limit. Boundaries compliant (see §2d).
- Air quantity: Q_required from `TP-AIRQTY-FACTORS` (perPerson 6, perTonne 2.5, m³/min) × district.personsLargestShift / district.dailyOutputTonnes at the district's `lastConnectionBranchId` sensor; SHORTFALL (measured < required) → CRITICAL; margin < 10% → WARNING.
- Compound heat rule: wetBulb > 30.5 (strictly) AND velocity < 1.0 → CRITICAL `type: COMPOUND`, parameter `wetBulb`.
- No hard-coded numbers anywhere in the engine/calculator: every limit/factor comes from enabled threshold profiles.

## 6. Alert lifecycle
- `ACTIVE → ACKNOWLEDGED → RESOLVED`. One open alert per `{sensorId, parameter, type}` (partial unique index on ACTIVE/ACKNOWLEDGED).
- Escalation (WARNING→CRITICAL): severity updates, acknowledgement is reset (back to ACTIVE), history appended.
- Auto-resolve: 3 consecutive normal readings with a 5 % deadband → RESOLVED (`resolution: "auto-resolved"`). Stale sensors never resolve gas alerts.
- Every alert stores `thresholdSnapshot` (profile values + sourceRef + sourceDate) and `origin: "simulated"`.
- Acknowledge: `POST /alerts/:id/acknowledge { note? }` → status ACKNOWLEDGED, history appended, emits `alert:updated`.

## 7. Stale sweeper (background, every ~2 s)
- `STALE` after 3 × expectedIntervalSec (9 s), `OFFLINE` after 10 × (30 s); startup grace of one interval.
- On transition: raise `SENSOR_COMMS` alert (severity WARNING) with `parameter: "comms"`.
- Overview `overallStatus` = `DEGRADED` when any `safetyCritical` sensor is STALE/OFFLINE (never NORMAL in that state).

## 8. Socket.IO (`/realtime`, server→client only, `auth: { token }`)
| Event | Payload |
|---|---|
| `reading:update` | `{ sensorId, measuredAt, values, quality }` (~3 s per sensor) |
| `sensor:status` | `{ sensorId, status, ts }` |
| `alert:created` / `alert:updated` / `alert:resolved` | full alert record |
| `system:status` | `{ overallStatus, serverTime }` |
| `config:changed` | `{ entity: "thresholds"\|"sensors"\|"branches", ts }` |

## 9. Pages (frontend)
`/login` · `/overview` (10 KPI cards: worst-case value + location + age; live table; alert summary) · `/map` (SVG schematic from branch geometry, labelled **"schematic — not a statutory ventilation plan"**) · `/sensors` · `/sensors/:id` (live + 1h/6h/24h/7d charts with source-labelled threshold lines) · `/alerts` · `/analytics` · `/calculator` (shows both Q components + working steps + rule sourceRefs) · `/thresholds` (versioned profiles with source/date, officer+ edit) · `/reports` (CSV, operator+).
Global: `SIMULATED DATA` banner; footer: *"Academic prototype — not a certified mine-safety system — verify statutory requirements before operational use."* Socket-disconnect banner greying values with age. Status = colour + icon + text (never colour alone); colour-blind-safe palette. Token in memory only; route guards; role-based UI hiding.

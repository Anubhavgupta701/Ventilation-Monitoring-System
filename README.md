<!-- ============================================================
  PROJECT NAME OPTIONS (pick one, delete the rest):
  1. Ventilation Monitoring System  ← recommended (strong, memorable, describes the product)
  2. AeroMine       (clean, professional — "air + mine")
  3. MinePulse      (live-monitoring feel)
  Repo slug: ventguard
============================================================ -->

# Ventilation Monitoring System

**Real-time mine ventilation monitoring & control-room simulator** — a full-stack web application that visualizes underground mine airflow, tracks gas/temperature/pressure sensors live, and simulates ventilation control (fans, doors, regulators) with a physics-backed engine.

> **Academic / research prototype** — not a certified mine-safety system. Statutory limits follow CMR 2017 Reg. 153 for reference only.

---

## ✨ What it does

VentGuard turns a mine's ventilation network into a **live control-room dashboard**:

- **🗺️ Interactive mine network map** — 13 branches across 4 levels, rendered as an SVG schematic with animated airflow particles that respond to real-time velocity data
- **🧊 2D network view** — a Three.js-powered 2D twin of the mine (`/network-3d`): 900 airflow particles, 8 live sensor markers, rotating main fan — all driven by the same live backend data via Socket.IO, with automatic demo fallback when the backend is offline
- **📡 Live sensor telemetry** — CH₄, CO₂, CO, O₂, temperature, humidity, pressure and fan status, streamed over WebSockets with stale-data detection
- **🎛️ Ventilation controls** — start/stop fans, open/close doors, adjust regulators — with server-side role enforcement
- **⚠️ Fault injection lab** — 12 realistic failure scenarios (fan trip, gas ingress, door left open…) to train operators and test response
- **⏪ Time machine** — replay historical telemetry and step through incidents
- **👥 Role-adaptive UI** — admin / operator / viewer / ventilation-officer views; restricted actions (e.g. fan stop) are denied server-side too, not just hidden in the UI
- **📋 Audit log & command palette** — every control action is logged; power users get a keyboard-first command bar
- **📊 Analytics, reports & threshold management** — per-sensor detail pages, dataset analysis, configurable alarm thresholds

**Design language:** deliberate light-industrial control-room aesthetic — warm white, ivory, sandstone, bronze/copper, safety amber and warning red. No dark-neon "AI SaaS" clichés.

---

## 🛠️ Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Three.js (3D view), Socket.IO client |
| Backend | Node.js, Express 4, Socket.IO 4, Mongoose 8 |
| Database | MongoDB (local `mongod`, seeded) |
| Simulation | In-process physics engine + pure-JS rule engine |
| Styling | Custom CSS — hand-rolled light-industrial theme |

**Architecture**
┌──────────────┐ ┌──────────────────────────┐ ┌───────────┐
│ React client │◄────►│ Node/Express API :4001 │◄────►│ MongoDB │
│ :5174 │ REST │ Socket.IO /realtime │ │ :27017 │
└──────────────┘ │ in-process simulator │ │ minevent │
│ rule engine (pure JS) │ └───────────┘
│ stale sweeper │
└──────────────────────────┘




---

## 🚀 Quick start

**Prerequisites:** Node.js 18+, MongoDB (the dev script can start a local `mongod` for you).

```bash
# 1. Install everything
npm run install:all

# 2. Seed the database (users, sensors, branches, districts, thresholds)
npm run seed

# 3. Start API + client with live reload
npm run dev
Then open:



Role	Username	Password	Can do
Admin	admin	admin123	Everything, incl. user management
Operator	operator	operator123	Control fans/doors/regulators
Ventilation Officer	vo	vo123	Thresholds, reports, analytics
Viewer	viewer	viewer123	Read-only monitoring
📁 Project structure


ventguard/
├── client/                 # React frontend (Vite)
│   └── src/
│       ├── pages/          # Overview, Network, Network3D, Sensors, Fans,
│       │                   #   Simulation, Analytics, Alerts, Reports, …
│       ├── three/          # Three.js 3D mine-network scene
│       ├── realtime/       # Socket.IO hooks & live-data layer
│       ├── ui/             # Shared components (command palette, cards…)
│       └── auth/           # Role-based auth context
├── server/                 # Express + Socket.IO + Mongoose API
│   └── src/
│       ├── routes/         # REST endpoints
│       ├── models/         # Mongoose schemas
│       ├── sim/            # Physics simulator & rule engine
│       └── middleware/     # Auth, role enforcement
├── docs/                   # API contract, design notes
└── data/                   # Seed datasets
⚙️ Physics & regulatory model
Correlated airflow physics — branch velocities derive from fan curves, regulator positions and network resistance; changing one control re-solves the network
Gas dispersion — CH₄/CO₂/CO concentrations respond to airflow changes and injection scenarios
Statutory thresholds — alarm limits modeled on CMR 2017 Regulation 153 (Indian coal-mine ventilation rules); DGMS 2025 circulars referenced in docs
Stale-data sweeper — sensors that stop reporting are flagged, never silently trusted
🧪 Fault-injection scenarios
Twelve scripted failures for training and what-if analysis, including: main fan trip, auxiliary fan failure, methane ingress at a working face, regulator stuck open/closed, ventilation door left open, sensor communication loss, and more. Each scenario can be triggered live or replayed via the time machine.

🗺️ Roadmap
 Multi-mine support (fleet view)
 Predictive alarming (trend-based, not just threshold-based)
 Mobile-responsive operator view
 Exportable compliance reports (PDF)
⚠️ Disclaimer
VentGuard is an academic research prototype built to explore real-time visualization and simulation for mine ventilation. It is not a certified mine-safety system and must not be used for operational safety decisions. Always verify statutory requirements with qualified professionals.

📄 License
MIT — free for academic and research use. See LICENSE.

👤 Author
Anubhav Gupta — B.Tech Mining Engineering, NIT Rourkela
🔗 GitHub · LinkedIn · Codolio

Built as a research project applying software engineering to mining — because the best person to digitize a mine is someone who understands both

# FIXES NOTE — v2.1 (1 Oct 2026)

Boss ne report kiya tha: fan stop / regulator / start-stop se "kuch nahi hota",
aur PDF/CSV download kaam nahi kar rahe. Sab theek kar diya, test karke.

## Kya fix hua

1. **Reports download (CSV/PDF)** — Reports page galat API paths call kar raha tha
   (404 aa raha tha). Ab 7 typed reports (daily-ventilation, sensor, incident,
   airflow-survey, gas-monitoring, fan-performance, compliance-calc) × CSV+PDF
   + 2 raw CSV (readings, alerts) — sab verify kiye: HTTP 200, CSV me rows,
   PDF `%PDF` signature ke saath khulta hai.

2. **Sensor report** — isko `sensorId` chahiye hota hai; page ab pehla station
   auto-select karta hai taaki download kabhi 400 na de.

3. **Fan stop/start** — API pehle se kaam karta tha, par stopped fan ka card
   phir bhi circuit airflow dikhata tha (confusing). Ab stopped fan ka card
   dikhata hai: status STOPPED, rpm 0, airflow 0 m³/min, pressure 0 Pa.
   Start pe sab wapas (RUNNING, 2347.9 m³/min, 1800 Pa).

4. **Airways page** — ab har fitting pe seedha control hai: door ke liye
   Open/Close button, regulator ke liye −5/−1/+1/+5 nudge buttons. Click karte
   hi physics agle tick me respond karti hai.

5. **Map inspector** — regulator me ±1%/±5% nudge buttons add hue (spec ke hisaab se).

## Verify kiya gaya (1 Oct 2026, live server)

- Backend tests: 28/28 pass (`npm test`)
- Client build: clean (`npm run build`)
- Fan stop → STOPPED/0/0; start → RUNNING/2347.9/1800 (API)
- Regulator nudge +5 → 75%, −5 → 70% (API)
- Door close → CLOSED, branch impact −97%; reopen → OPEN (API)
- 16/16 downloads: 7 reports × CSV+PDF + 2 raw CSV — sab 200, non-empty

## Chalane ka tarika

Windows: `start-windows.bat` double-click → http://localhost:5174
Login: `admin` / `admin123` (dev accounts — deployment me badal dena)

Fan stop test: Fans page → FAN-MAIN pe **Stop** → confirm → ~7 sec me card pe
STOPPED / 0 rpm / 0 airflow dikhega. Regulator test: Airways page → kisi
regulator pe **+5** dabao → opening % badhega.

Academic prototype — not a certified mine-safety system.
DATA MODE: SIMULATION.

---

## v2.2 — Login page access-level cards (2 Oct 2026)

**Problem found:** the login page's "Demo accounts" hint listed stale credentials
(`officer / officer123`, `operator / operator123`) that return **401** against the real
seed (`ventoff / ventoff123`, `operator / op123`). Anyone copying them could not sign in.

**Change (`client/src/pages/Login.jsx`, `client/src/styles.css`):**
- Replaced the plain hint with an **Access levels** panel: 4 cards (Admin, Ventilation
  Officer, Operator, Viewer), each showing the correct seeded username/password and a
  one-line summary of that role's powers.
- **Tap a card to fill sign-in** — clicking a card auto-fills the username/password fields.
- Styling follows the existing industrial theme (serif role names, bronze accents).

**Verified 2 Oct 2026:**
- `POST /api/v1/auth/login` → 200 for all four seeded accounts with correct roles
  (admin, officer, operator, viewer); the two stale pairs from the old hint → 401.
- Client production build clean; login page screenshot inspected — cards render correctly.

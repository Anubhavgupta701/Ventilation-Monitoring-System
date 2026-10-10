# sample-mine-readings.csv — format & story

**File:** `data/sample-mine-readings.csv` (16,091 rows, ~1 MB)
**Regenerate:** `node data/generate-sample-csv.js` (seeded RNG — reproducible)
**Window:** 2026-09-24T00:00:00Z → 2026-09-30T23:55:00Z, 5-minute intervals, 8 stations (S1–S8)

## Columns

| column | unit | notes |
|---|---|---|
| timestamp | ISO-8601 UTC | measurement time |
| sensor_id | S1..S8 | station id |
| ch4_pct | % vol | inflammable gas |
| co2_pct | % vol | carbon dioxide |
| co_ppm | ppm | carbon monoxide |
| o2_pct | % vol | oxygen |
| temp_c | °C | dry-bulb temperature |
| wetbulb_c | °C | wet-bulb temperature |
| rh_pct | % | relative humidity |
| pressure_pa | Pa | absolute pressure |
| airflow_m3min | m³/min | air quantity |
| velocity_ms | m/s | air velocity |
| dust_mg_m3 | mg/m³ | respirable dust |
| fan_rpm | rpm | main fan speed |

Empty cell = that station does not measure the parameter. Station parameter sets
mirror the live simulator seed, except S5 also carries `velocity_ms` in this file
(needed for the heat-episode analysis).

## Embedded events (ground truth for analysis demos)

1. **Gas excursion — 2026-09-27 02:00→04:00 UTC.** S4 (district return, general body)
   CH₄ ramps 0.22% → **0.908% peak at 03:00** → recovers. Crosses the 0.75%
   district-return limit. S6 shows a smaller downwind echo (~0.55%).
2. **Fan dip — 2026-09-25 10:00→10:45 UTC.** S8 fan 740 → **540 rpm**; S7/S6/S1
   airflow and velocity sag ~30% in step.
3. **Heat episode — 2026-09-28 06:00→14:00 UTC.** S5 dry-bulb → **34.3°C**,
   wet-bulb → **32.9°C** (nears the 33.5°C ceiling), velocity collapses to
   **0.30 m/s** — violates the wet-bulb > 30.5°C ⇒ velocity ≥ 1 m/s rule.
4. **Comms dropout — 2026-09-29 08:00→11:00 UTC.** S6 rows missing
   (1979 rows vs 2016 for the other stations).
5. **Shift-change dust** — S5 dust ×2.4 daily at 05:30–06:30 and 17:30–18:30 UTC.

## Suggested analyses

- Exceedance hunt: rows breaching CH₄ ≥ 0.75% (S4), wet-bulb ≥ 33.5°C,
  wet-bulb > 30.5°C with velocity < 1 m/s, O₂ < 19%, CO₂ > 0.5%.
- Event windows: min/max/mean per parameter inside vs outside each event.
- Fan-dip propagation: airflow/velocity lag across S7 → S6 → S1.
- Diurnal decomposition of temperature/wet-bulb at S5.
- Gap report: missing intervals per station (the S6 dropout).

All figures are synthetic but physically plausible; the file is labelled
`SIMULATED DATA` wherever it is surfaced in the UI.

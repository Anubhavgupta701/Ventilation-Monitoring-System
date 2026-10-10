// Generates a realistic 7-day mine ventilation readings CSV for analysis.
// Seeded RNG => reproducible. Run: node generate-sample-csv.js
const fs = require('fs');
const path = require('path');

// mulberry32 seeded RNG
let _s = 20260930;
function rnd() {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() { return (rnd() + rnd() + rnd() - 1.5) / 1.5; } // ~N(0, ~0.4)
function nz(base, amp) { return base + gauss() * amp; }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const f2 = v => (v === '' || v == null ? '' : Number(v).toFixed(2));
const f3 = v => (v === '' || v == null ? '' : Number(v).toFixed(3));
const f1 = v => (v === '' || v == null ? '' : Number(v).toFixed(1));
const i0 = v => (v === '' || v == null ? '' : Math.round(v));

const SENSORS = {
  S1: ['airflow', 'velocity', 'pressure', 'temp', 'wetBulb', 'humidity'],
  S2: ['airflow', 'velocity', 'pressure'],
  S3: ['airflow', 'velocity', 'temp', 'wetBulb', 'humidity'],
  S4: ['ch4', 'co2', 'co', 'o2', 'velocity', 'temp', 'wetBulb', 'humidity'],
  S5: ['ch4', 'co2', 'co', 'o2', 'temp', 'wetBulb', 'humidity', 'dust', 'velocity'],
  S6: ['ch4', 'co2', 'o2', 'pressure', 'airflow', 'velocity'],
  S7: ['pressure', 'airflow', 'velocity', 'fanRpm'],
  S8: ['fanRpm', 'temp', 'pressure'],
};

// 7 days: 2026-09-24T00:00Z .. 2026-09-30T23:55Z, 5-min steps
const START = Date.UTC(2026, 8, 24, 0, 0, 0);
const STEPS = 7 * 24 * 12;

function diurnal(ms, base, amp, peakHourUTC = 8) {
  const h = new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
  return base + amp * Math.sin(((h - peakHourUTC + 6) / 24) * 2 * Math.PI);
}
// event windows (ms offsets from START)
const D = 86400000, H = 3600000, M = 60000;
const gasEvent = [START + 3 * D + 2 * H, START + 3 * D + 4 * H];          // day4 02:00-04:00 CH4 excursion
const fanDip = [START + 1 * D + 10 * H, START + 1 * D + 10 * H + 45 * M]; // day2 10:00-10:45
const heatEp = [START + 4 * D + 6 * H, START + 4 * D + 14 * H];           // day5 06:00-14:00
const dropoutS6 = [START + 5 * D + 8 * H, START + 5 * D + 11 * H];        // day6 08:00-11:00 S6 gap

function ramp(ms, w, peak) {
  const [a, b] = w, mid = (a + b) / 2;
  if (ms < a || ms > b) return 0;
  return ms < mid ? peak * (ms - a) / (mid - a) : peak * (b - ms) / (b - mid);
}
function inWin(ms, w) { return ms >= w[0] && ms <= w[1]; }
function shiftDust(ms) { // shift-change dust spikes 05:30-06:30 & 17:30-18:30
  const t = new Date(ms), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  const inA = mins >= 330 && mins <= 390, inB = mins >= 1050 && mins <= 1110;
  return (inA || inB) ? 2.4 : 1.0;
}

const rows = [];
rows.push('timestamp,sensor_id,ch4_pct,co2_pct,co_ppm,o2_pct,temp_c,wetbulb_c,rh_pct,pressure_pa,airflow_m3min,velocity_ms,dust_mg_m3,fan_rpm');

let count = 0;
for (let s = 0; s < STEPS; s++) {
  const ms = START + s * 5 * M;
  const iso = new Date(ms).toISOString();
  const gasR = ramp(ms, gasEvent, 1);      // 0..1 gas event envelope
  const fanR = ramp(ms, fanDip, 1);        // 0..1 fan dip envelope
  const heatR = ramp(ms, heatEp, 1);       // 0..1 heat episode envelope
  const fanFactor = 1 - 0.30 * fanR;       // fan dips 30%

  for (const sid of Object.keys(SENSORS)) {
    if (sid === 'S6' && inWin(ms, dropoutS6)) continue; // comms dropout
    const P = SENSORS[sid];
    const v = {};
    const has = p => P.includes(p);
    if (has('ch4')) {
      let base = sid === 'S4' ? 0.22 : sid === 'S5' ? 0.15 : 0.30;
      let val = nz(base, 0.05);
      if (sid === 'S4') val += gasR * 0.70;            // -> ~0.92% peak
      if (sid === 'S6') val += gasR * 0.25;            // downwind echo
      v.ch4 = f3(clamp(val, 0.02, 1.2));
    }
    if (has('co2')) v.co2 = f3(clamp(nz(sid === 'S5' ? 0.18 : 0.12, 0.03), 0.02, 0.6));
    if (has('co')) v.co = f1(clamp(nz(sid === 'S5' ? 5 : 3, 1.2), 0, 40));
    if (has('o2')) v.o2 = f2(clamp(nz(20.6, 0.12) - (has('ch4') ? parseFloat(v.ch4) * 0.15 : 0), 19.5, 21));
    if (has('temp')) {
      let base = sid === 'S5' ? 31 : sid === 'S8' ? 33 : 28.5;
      let t = diurnal(ms, base, sid === 'S5' ? 2.2 : 1.8) + gauss() * 0.3;
      if (sid === 'S5') t += heatR * 1.3;
      v.temp = f1(clamp(t, 20, 42));
    }
    if (has('wetBulb')) {
      // wet-bulb depression shrinks as heat/humidity rise
      const depression = 2.6 - heatR * 1.2 + gauss() * 0.4;
      const wb = (has('temp') ? parseFloat(v.temp) : 29) - depression;
      v.wetBulb = f1(clamp(wb, 18, 36));
    }
    if (has('humidity')) v.humidity = f1(clamp(nz(68, 5) + heatR * 8, 35, 98));
    if (has('pressure')) {
      let base = sid === 'S7' ? 97900 : sid === 'S8' ? 98100 : sid === 'S6' ? 98200 : sid === 'S2' ? 98500 : 98700;
      v.pressure = i0(nz(base, 60) - fanR * 400);
    }
    if (has('airflow')) {
      let base = sid === 'S7' ? 5300 : sid === 'S6' ? 4200 : sid === 'S1' ? 2600 : sid === 'S2' ? 1400 : 900;
      v.airflow = i0(clamp(nz(base * fanFactor, base * 0.02), 100, 7000));
    }
    if (has('velocity')) {
      let base = sid === 'S7' ? 3.4 : sid === 'S6' ? 2.8 : sid === 'S1' ? 2.2 : sid === 'S2' ? 1.8 : sid === 'S3' ? 1.2 : 1.1;
      let vv = nz(base * fanFactor, 0.08);
      if (sid === 'S5' && heatR > 0) vv = 0.35 + gauss() * 0.05; // recirculation during heat episode
      v.velocity = f2(clamp(vv, 0.1, 5));
    }
    if (has('dust')) v.dust = f2(clamp(nz(1.2, 0.35) * shiftDust(ms), 0.2, 8));
    if (has('fanRpm')) v.fanRpm = i0(nz(740 * (sid === 'S8' ? fanFactor : 1), 8));

    rows.push([iso, sid, v.ch4 || '', v.co2 || '', v.co || '', v.o2 || '',
      v.temp || '', v.wetBulb || '', v.humidity || '', v.pressure || '',
      v.airflow || '', v.velocity || '', v.dust || '', v.fanRpm || ''].join(','));
    count++;
  }
}

const out = path.join(__dirname, 'sample-mine-readings.csv');
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log('wrote', out, count, 'rows,', (fs.statSync(out).size / 1048576).toFixed(2), 'MB');

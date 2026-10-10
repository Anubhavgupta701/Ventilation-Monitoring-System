import React, { useState } from "react";
import { Calculations } from "../lib/api";
import { useToast } from "../ui/toast";
import { Notice, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { fmtNum } from "../lib/format";
import { IconInfo } from "../ui/icons";

const FIELDS = [
  { key: "persons", label: "Persons on largest shift", unit: "persons", required: true, min: 0 },
  { key: "dailyOutputTonnes", label: "Daily output", unit: "tonnes/day", required: true, min: 0 },
  { key: "area", label: "Airway cross-section at measuring point", unit: "m²", required: true, min: 0.01 },
  { key: "measuredAirflow", label: "Measured airflow", unit: "m³/min", required: true, min: 0 },
  { key: "wetBulb", label: "Wet-bulb temperature", unit: "°C", required: false },
  { key: "measuredVelocity", label: "Measured air velocity", unit: "m/s", required: false },
];

export default function CalculatorPage() {
  const { pushApiError } = useToast();
  const [inputs, setInputs] = useState({
    persons: "120",
    dailyOutputTonnes: "400",
    area: "8",
    measuredAirflow: "900",
    wetBulb: "",
    measuredVelocity: "",
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {};
      for (const f of FIELDS) {
        const raw = inputs[f.key];
        if (raw === "" || raw === null) {
          if (f.required) throw new Error(`${f.label} is required.`);
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${f.label} must be a non-negative number.`);
        body[f.key] = n;
      }
      const res = await Calculations.ventilation(body);
      setResult(res);
    } catch (err) {
      setError(err);
      pushApiError(err, "Calculation failed.");
    } finally {
      setBusy(false);
    }
  };

  const r = result?.results;

  return (
    <>
      <PageHeader
        eyebrow="Statutory arithmetic"
        scriptWord="Ventilation"
        title="calculator"
        lede="Required air quantity from persons and output, velocity from airflow and area, and the wet-bulb heat rule — every step shown with its expression and rule source. Factors come from the threshold profile, never hard-coded."
      />

      <Notice kind="warn" title="Research arithmetic, not a compliance certificate">
        This calculator reproduces the rule-engine maths for study. A statutory compliance
        determination needs the current CMR/DGMS text, calibrated instruments and a competent
        ventilation officer's sign-off.
      </Notice>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Inputs</span>
          </div>
          <form onSubmit={submit}>
            <div className="form-grid">
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`calc-${f.key}`}>
                    {f.label} <span className="unit-tag">{f.unit}</span>
                    {f.required ? "" : " (optional)"}
                  </label>
                  <input
                    id={`calc-${f.key}`}
                    type="number"
                    step="any"
                    min="0"
                    value={inputs[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    required={f.required}
                  />
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ marginTop: 4 }}>
              {busy ? "Calculating…" : "Run calculation"}
            </button>
          </form>

          {error && !result ? (
            <div style={{ marginTop: 14 }}>
              <StatePanel title="Calculation failed" requestId={error.requestId} icon={<IconInfo size={24} />}>
                {error.message}
              </StatePanel>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="eyebrow">Rule factors in force</span>
          </div>
          {result?.factors ? (
            <dl>
              <div className="kv">
                <dt>Per person</dt>
                <dd>{result.factors.perPerson} m³/min</dd>
              </div>
              <div className="kv">
                <dt>Per tonne of output</dt>
                <dd>{result.factors.perTonne} m³/min</dd>
              </div>
              <div className="kv">
                <dt>Source ref</dt>
                <dd style={{ fontFamily: "var(--sans)", fontSize: 12.5 }}>{result.factors.sourceRef}</dd>
              </div>
            </dl>
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: 13 }}>
              Run the calculation to load the factors the server used — they are read from the
              enabled <span className="mono">TP-AIRQTY-FACTORS</span> threshold profile, not
              hard-coded in the client.
            </div>
          )}
          {result?.inputs ? (
            <details className="collapsible" style={{ marginTop: 12 }}>
              <summary>Inputs as received by the server</summary>
              <div className="body mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                {Object.entries(result.inputs).map(([k, v]) => (
                  <div key={k}>
                    {k}: {String(v)}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      {r ? (
        <>
          <div className="grid-2 section-gap">
            <div className="card">
              <div className="card-head">
                <span className="eyebrow">Required quantity — both components</span>
              </div>
              <div className="stat-strip" style={{ gap: 30 }}>
                <div className="stat">
                  <div className="k">Q by persons</div>
                  <div className="n">{fmtNum(r.qByPersons, 1)} <span style={{ fontSize: 11, color: "var(--text-3)" }}>m³/min</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>6 m³/min × persons</div>
                </div>
                <div className="stat">
                  <div className="k">Q by output</div>
                  <div className="n">{fmtNum(r.qByOutput, 1)} <span style={{ fontSize: 11, color: "var(--text-3)" }}>m³/min</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>2.5 m³/min × tonnes</div>
                </div>
                <div className="stat">
                  <div className="k">Q required (max)</div>
                  <div className="n" style={{ color: "var(--warn)" }}>{fmtNum(r.qRequired, 1)} <span style={{ fontSize: 11, color: "var(--text-3)" }}>m³/min</span></div>
                </div>
              </div>
              <div className="stat-strip" style={{ gap: 30, marginTop: 16 }}>
                <div className="stat">
                  <div className="k">Velocity at measuring point</div>
                  <div className="n">{r.velocity != null ? fmtNum(r.velocity, 2) : "—"} <span style={{ fontSize: 11, color: "var(--text-3)" }}>m/s</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>v = Q / 60 / A</div>
                </div>
                <div className="stat">
                  <div className="k">Compliance margin</div>
                  <div className="n" style={{ color: r.complianceMargin >= 0 ? "var(--ok)" : "var(--crit)" }}>
                    {r.complianceMargin != null ? `${fmtNum(r.complianceMargin * 100, 1)} %` : "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>(measured − required) / required</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <StatusPill status={r.airQuantity} customLabel={r.airQuantity === "OK" ? "Air quantity OK" : "Air quantity shortfall"} />
                <StatusPill status={r.heatRule} customLabel={
                  r.heatRule === "OK" ? "Heat rule OK" : r.heatRule === "VIOLATED" ? "Heat rule violated" : "Heat rule N/A"
                } />
                {r.velocityRequired != null ? (
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", alignSelf: "center" }}>
                    velocity required: {fmtNum(r.velocityRequired, 2)} m/s
                  </span>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span className="eyebrow">Working steps</span>
              </div>
              <div className="table-wrap" style={{ border: "none" }}>
                <table className="grid step-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Expression</th>
                      <th className="num">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.steps || []).map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{s.label}</td>
                        <td className="expr">{s.expr}</td>
                        <td className="num mono">{s.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={`verdict ${r.overall === "COMPLIANT" ? "compliant" : "non"}`}>
            <StatusPill status={r.overall} />
            <div>
              <div className="big">{r.overall === "COMPLIANT" ? "Compliant" : "Non-compliant"}</div>
              <div style={{ color: "var(--text-2)", fontSize: 13 }}>
                {r.overall === "COMPLIANT"
                  ? "Measured airflow meets the required quantity and the heat rule holds (where applicable)."
                  : "The measured airflow falls short of the required quantity, or the heat rule is violated — see components above."}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

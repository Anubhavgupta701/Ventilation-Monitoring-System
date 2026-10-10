import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../ui/icons";

/* Technical mine line-art for the login panel — intake portal, shaft,
   drifts, stoppings, fan drift. Muted bronze on charcoal. */
function MineArt() {
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="hatch" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="14" stroke="#3a2f1d" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="800" height="1000" fill="#241d12" />
      <rect width="800" height="330" fill="url(#hatch)" opacity="0.55" />
      {/* surface works */}
      <g stroke="#b0763a" strokeWidth="2" fill="none" opacity="0.9">
        <rect x="90" y="180" width="120" height="70" />
        <path d="M90 180l30-40h60l30 40" />
        <rect x="250" y="195" width="90" height="55" />
        <circle cx="560" cy="220" r="34" />
        <path d="M560 186v-30M560 254v30M526 220h-30M594 220h30" />
      </g>
      <g stroke="#8a5a24" strokeWidth="1.4" opacity="0.8">
        <path d="M150 250v80M295 250v80M560 254v76" />
      </g>
      {/* shaft */}
      <g stroke="#b0763a" strokeWidth="3" fill="none">
        <path d="M150 330v300M210 330v300" />
        <path d="M150 380h60M150 440h60M150 500h60M150 560h60" strokeWidth="1.4" />
      </g>
      {/* main drift */}
      <g stroke="#b0763a" strokeWidth="3" fill="none">
        <path d="M210 470h430" />
        <path d="M210 500h430" />
      </g>
      {/* crosscuts */}
      <g stroke="#8a5a24" strokeWidth="2" fill="none" opacity="0.9">
        <path d="M300 470v-90M300 500v120M420 470v-90M420 500v120M540 470v-90M540 500v120" />
        <path d="M285 380h30M405 380h30M525 380h30" />
        <path d="M285 620h30M405 620h30M525 620h30" />
      </g>
      {/* stoppings */}
      <g stroke="#b0763a" strokeWidth="1.6" opacity="0.85">
        <path d="M300 470l14 14M314 470l-14 14M300 500l14 14M314 500l-14 14" />
        <path d="M420 470l14 14M434 470l-14 14M420 500l14 14M434 500l-14 14" />
      </g>
      {/* fan drift + fan */}
      <g stroke="#b0763a" strokeWidth="2.5" fill="none">
        <path d="M640 470v140M670 470v140" />
        <circle cx="655" cy="640" r="26" />
        <path d="M655 640c-9-4-14-11-11-19 3-8 14-6 16 3M655 640c9 4 14 11 11 19-3 8-14 6-16-3M655 640c-4 9-11 14-19 11-8-3-6-14 3-16M655 640c4-9 11-14 19-11 8 3 6 14-3 16" />
      </g>
      {/* sensor markers */}
      <g fill="#b0763a">
        <circle cx="255" cy="485" r="6" />
        <circle cx="360" cy="485" r="6" />
        <circle cx="480" cy="485" r="6" />
        <circle cx="600" cy="485" r="6" />
      </g>
      <g stroke="#b0763a" strokeWidth="1.2" fill="none">
        <circle cx="255" cy="485" r="11" />
        <circle cx="360" cy="485" r="11" />
        <circle cx="480" cy="485" r="11" />
        <circle cx="600" cy="485" r="11" />
      </g>
      {/* depth ticks */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="15" fill="#8a7d67">
        <text x="30" y="400">−120 m</text>
        <text x="30" y="500">−240 m</text>
        <text x="30" y="600">−360 m</text>
        <text x="30" y="700">−480 m</text>
      </g>
      <g stroke="#3a2f1d" strokeWidth="1">
        <path d="M70 392h730M70 492h730M70 592h730M70 692h730" strokeDasharray="6 6" />
      </g>
    </svg>
  );
}

const ROLES = [
  {
    name: "Admin",
    user: "admin",
    pass: "admin123",
    powers: "Everything — user management, settings, all controls",
  },
  {
    name: "Ventilation Officer",
    user: "ventoff",
    pass: "ventoff123",
    powers: "Fault scenarios, threshold profiles, settings + operator powers",
  },
  {
    name: "Operator",
    user: "operator",
    pass: "op123",
    powers: "Fan / door / regulator controls, sim transport, report exports",
  },
  {
    name: "Viewer",
    user: "viewer",
    pass: "view123",
    powers: "Read-only — live monitoring, no controls, no exports",
  },
];

export default function Login() {
  const { isAuthed, login, busy } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  if (isAuthed) {
    const dest = location.state?.from?.pathname || "/overview";
    return <Navigate to={dest} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
      const from = location.state?.from?.pathname || "/overview";
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    }
  };

  const fill = (r) => {
    setUsername(r.user);
    setPassword(r.pass);
    setError(null);
  };

  return (
    <div className="login-wrap">
      <div className="login-art">
        <MineArt />
        <div className="art-cap">
          <div className="k">Underground section · not to scale</div>
          <h2>
            The airway network, <span className="serif-i" style={{ color: "#d8a85c" }}>drawn to think.</span>
          </h2>
          <p>
            A control-room simulator for mine ventilation research — fans, doors, regulators,
            faults and airflow, all simulated against CMR 2017 statutory limits.
          </p>
        </div>
      </div>
      <div className="login-form-col">
        <div className="login-card">
          <div className="login-brand">
            <BrandMark size={46} />
            <span className="serif-i">Vent</span>
            <div className="serif-title">Mine Ventilation Monitoring<br />&amp; Simulation System</div>
            <div className="sub">Academic research prototype</div>
          </div>
          {error ? <div className="login-error">{error}</div> : null}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="login-user">Username</label>
              <input
                id="login-user"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-pass">Password</label>
              <input
                id="login-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
              {busy ? "Signing in…" : "Sign in to control room"}
            </button>
          </form>
          <div className="access-levels">
            <div className="al-head">
              <span>Access levels</span>
              <span className="al-tap">tap a card to fill sign-in</span>
            </div>
            <div className="al-grid">
              {ROLES.map((r) => (
                <button type="button" key={r.user} className="al-card" onClick={() => fill(r)} title={`Fill ${r.user} / ${r.pass}`}>
                  <div className="al-role">{r.name}</div>
                  <div className="al-cred">{r.user} · {r.pass}</div>
                  <div className="al-powers">{r.powers}</div>
                </button>
              ))}
            </div>
            <div className="al-note">
              All telemetry is <b>simulated</b>. Academic prototype — not a certified mine-safety system.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./toast";
import { useInspector } from "./InspectorContext";
import { Branches, Doors, Fans, Regulators, Sensors as SensorsApi, Simulator } from "../lib/api";
import {
  IconBell, IconCalc, IconChart, IconDoc, IconFan, IconGauge, IconLayers,
  IconMap, IconPause, IconPlay, IconReset, IconSearch, IconSensor, IconSim, IconAudit,
  IconShield,
} from "./icons";

/* Ctrl+K command palette — navigation, layers, sim transport, object lookup. */
export default function CommandPalette({ open, onClose, onLayer }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { select } = useInspector();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [objects, setObjects] = useState({ sensors: [], branches: [], fans: [], doors: [], regs: [] });
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    (async () => {
      try {
        const [s, b, f, d, r] = await Promise.allSettled([
          SensorsApi.list(),
          Branches.list(),
          Fans.list(),
          Doors.list(),
          Regulators.list(),
        ]);
        setObjects({
          sensors: s.status === "fulfilled" ? arr(s.value, "sensors") : [],
          branches: b.status === "fulfilled" ? arr(b.value, "branches") : [],
          fans: f.status === "fulfilled" ? arr(f.value, "fans") : [],
          doors: d.status === "fulfilled" ? arr(d.value, "doors") : [],
          regs: r.status === "fulfilled" ? arr(r.value, "regulators") : [],
        });
      } catch {
        /* offline — palette still offers static commands */
      }
    })();
  }, [open ]);

  const arr = (v, key) => {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v[key])) return v[key];
    return [];
  };

  const canControl = hasRole("Operator");

  const simAct = async (label, fn) => {
    try {
      await fn();
      pushToast(label, "success");
    } catch (e) {
      pushApiError(e, label);
    }
    onClose();
  };

  const go = (to, state) => {
    navigate(to, state ? { state } : undefined);
    onClose();
  };

  const LAYERS = ["AIRFLOW", "PRESSURE", "CH4", "CO", "CO2", "O2", "TEMPERATURE", "HUMIDITY"];

  const commands = useMemo(() => {
    const list = [];
    const needle = q.trim().toLowerCase();

    // static navigation commands
    const nav = [
      ["Navigate", "Overview", <IconGauge size={15} key="i" />, () => go("/overview")],
      ["Navigate", "Ventilation network map", <IconMap size={15} key="i" />, () => go("/network")],
      ["Navigate", "Sensors", <IconSensor size={15} key="i" />, () => go("/sensors")],
      ["Navigate", "Fans", <IconFan size={15} key="i" />, () => go("/fans")],
      ["Navigate", "Airways", <IconLayers size={15} key="i" />, () => go("/airways")],
      ["Navigate", "Alerts — open alert desk", <IconBell size={15} key="i" />, () => go("/alerts")],
      ["Navigate", "Simulation — faults & scenarios", <IconSim size={15} key="i" />, () => go("/simulation")],
      ["Navigate", "Analytics", <IconChart size={15} key="i" />, () => go("/analytics")],
      ["Navigate", "Ventilation calculator", <IconCalc size={15} key="i" />, () => go("/calculator")],
      ["Navigate", "Reports", <IconDoc size={15} key="i" />, () => go("/reports")],
      ["Navigate", "Audit log", <IconAudit size={15} key="i" />, () => go("/audit")],
    ];
    if (hasRole("Officer")) {
      nav.push(["Navigate", "Threshold profiles", <IconShield size={15} key="i" />, () => go("/thresholds")]);
    }
    list.push(...nav);

    if (canControl) {
      list.push(
        ["Simulator", "Pause simulation", <IconPause size={15} key="i" />, () => simAct("Simulation paused.", () => Simulator.pause())],
        ["Simulator", "Resume simulation", <IconPlay size={15} key="i" />, () => simAct("Simulation resumed.", () => Simulator.resume())],
        ["Simulator", "Reset simulation", <IconReset size={15} key="i" />, () => simAct("Simulation reset.", () => Simulator.reset())],
        ["Simulator", "Speed 1×", <IconGauge size={15} key="i" />, () => simAct("Speed → 1×.", () => Simulator.setSpeed(1))],
        ["Simulator", "Speed 5×", <IconGauge size={15} key="i" />, () => simAct("Speed → 5×.", () => Simulator.setSpeed(5))],
        ["Simulator", "Speed 10×", <IconGauge size={15} key="i" />, () => simAct("Speed → 10×.", () => Simulator.setSpeed(10))],
      );
    }

    LAYERS.forEach((l) => {
      list.push([
        "Layer",
        `Map layer — ${l}`,
        <IconLayers size={15} key="i" />,
        () => {
          if (onLayer) onLayer(l);
          go("/network", { layer: l });
        },
      ]);
    });

    // object lookup
    objects.sensors.forEach((s) => {
      list.push([
        "Sensor",
        `${s.sensorId} — ${s.name || ""}`,
        <IconSensor size={15} key="i" />,
        () => {
          select("sensor", s.sensorId, s);
          go("/network");
        },
      ]);
    });
    objects.branches.forEach((b) => {
      list.push([
        "Airway",
        `${b.branchId} — ${b.name || ""}`,
        <IconLayers size={15} key="i" />,
        () => {
          select("branch", b.branchId, b);
          go("/network");
        },
      ]);
    });
    objects.fans.forEach((f) => {
      list.push([
        "Fan",
        `${f.fanId} — ${f.name || ""}`,
        <IconFan size={15} key="i" />,
        () => {
          select("fan", f.fanId, f);
          go("/network");
        },
      ]);
    });
    objects.doors.forEach((d) => {
      list.push([
        "Door",
        `${d.doorId} — ${d.name || ""}`,
        <IconSearch size={15} key="i" />,
        () => {
          select("door", d.doorId, d);
          go("/network");
        },
      ]);
    });
    objects.regs.forEach((r) => {
      list.push([
        "Regulator",
        `${r.regulatorId} — ${r.name || ""}`,
        <IconSearch size={15} key="i" />,
        () => {
          select("regulator", r.regulatorId, r);
          go("/network");
        },
      ]);
    });

    if (!needle) return list.slice(0, 14);
    return list.filter(([, label]) => label.toLowerCase().includes(needle)).slice(0, 14);
  }, [q, objects]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setIdx(0), [q]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = commands[idx];
      if (c) c[3]();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="cmdk-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command or search sensors, airways, fans…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="Command search"
        />
        <div className="cmdk-list">
          {commands.length === 0 ? (
            <div style={{ padding: "18px", color: "var(--text-3)", fontSize: 13 }}>
              No matches. Try “alerts”, “CH4”, “S4”, “fan”…
            </div>
          ) : (
            commands.map((c, i) => (
              <button
                key={`${c[0]}-${c[1]}-${i}`}
                className={`cmdk-item${i === idx ? " selected" : ""}`}
                onClick={() => c[3]()}
                onMouseEnter={() => setIdx(i)}
              >
                <span className="grp">{c[0]}</span>
                {c[2]}
                <span>{c[1]}</span>
                <span className="hint-k">{i === idx ? "↵" : ""}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

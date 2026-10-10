import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../ui/toast";

/* Socket.IO namespace /realtime — server→client only.
   Graceful when the backend is absent: socket keeps retrying,
   UI shows the disconnect banner and greys out live values.

   v1 events: reading:update, sensor:status, alert:created/updated/resolved,
   system:status, config:changed.
   v2 sim events: sim:tick, sim:status, fan:updated, door:updated,
   regulator:updated, fault:injected, fault:recovered, alert:updated. */
const RealtimeContext = createContext(null);

const EMPTY_SIM = {
  running: null,
  paused: null,
  speed: null,
  simTime: null,
  scenario: null,
  activeFaults: [],
  tickMs: null,
  overallStatus: null,
  Qreq: null,
  kpis: null,
  branches: {},
  fans: [],
  doors: [],
  regulators: [],
};

export function RealtimeProvider({ children }) {
  const { token } = useAuth();
  const { pushToast } = useToast();
  const [connected, setConnected] = useState(false);
  const [lastMsgAt, setLastMsgAt] = useState(null);
  const [readings, setReadings] = useState({}); // sensorId -> { measuredAt, values, quality }
  const [statuses, setStatuses] = useState({}); // sensorId -> { status, ts }
  const [overallStatus, setOverallStatus] = useState(null);
  const [serverTime, setServerTime] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [configTick, setConfigTick] = useState(0);
  const [sim, setSim] = useState(EMPTY_SIM);
  const [faultTick, setFaultTick] = useState(0); // bump on fault inject/recover
  const [equipmentTick, setEquipmentTick] = useState(0); // bump on fan/door/regulator updates
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }
    const socket = io("http://localhost:4001/realtime", {
      auth: { token },
      reconnectionDelayMax: 10000,
    });

    const mark = () => setLastMsgAt(Date.now());

    socket.on("connect", () => {
      setConnected(true);
      mark();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    socket.on("reading:update", (p) => {
      mark();
      if (p && p.sensorId) {
        setReadings((prev) => ({ ...prev, [p.sensorId]: p }));
      }
    });
    socket.on("sensor:status", (p) => {
      mark();
      if (p && p.sensorId) {
        setStatuses((prev) => ({ ...prev, [p.sensorId]: { status: p.status, ts: p.ts } }));
      }
    });
    socket.on("alert:created", (a) => {
      mark();
      if (a) {
        setRecentAlerts((prev) => [a, ...prev].slice(0, 25));
        const label = `${a.parameter || "parameter"} ${a.severity || ""}`.trim();
        pushToastRef.current(
          `New ${a.severity === "CRITICAL" ? "CRITICAL" : "warning"} alert — ${label} at ${a.sensorId || "unknown sensor"}`,
          a.severity === "CRITICAL" ? "critical" : "warning",
          8000
        );
      }
    });
    socket.on("alert:updated", (a) => {
      mark();
      if (a) setRecentAlerts((prev) => [a, ...prev].slice(0, 25));
    });
    socket.on("alert:resolved", (a) => {
      mark();
      if (a) setRecentAlerts((prev) => [a, ...prev].slice(0, 25));
    });
    socket.on("system:status", (p) => {
      mark();
      if (p) {
        setOverallStatus(p.overallStatus || null);
        setServerTime(p.serverTime || null);
      }
    });
    socket.on("config:changed", () => {
      mark();
      setConfigTick((t) => t + 1);
    });

    /* ---- v2 simulator events ---- */
    socket.on("sim:tick", (p) => {
      mark();
      if (p) {
        setSim((prev) => ({
          ...prev,
          running: p.running ?? prev.running,
          paused: p.paused ?? prev.paused,
          speed: p.speed ?? prev.speed,
          simTime: p.simTime ?? prev.simTime,
          scenario: p.scenario ?? prev.scenario,
          activeFaults: p.activeFaults ?? prev.activeFaults,
          tickMs: p.tickMs ?? prev.tickMs,
          overallStatus: p.overallStatus ?? prev.overallStatus,
          Qreq: p.Qreq ?? prev.Qreq,
          kpis: p.kpis ?? prev.kpis,
          branches: p.branches ?? prev.branches,
          fans: p.fans ?? prev.fans,
          doors: p.doors ?? prev.doors,
          regulators: p.regulators ?? prev.regulators,
        }));
      }
    });
    socket.on("sim:status", (p) => {
      mark();
      if (p) {
        setSim((prev) => ({
          ...prev,
          running: p.running ?? prev.running,
          paused: p.paused ?? prev.paused,
          speed: p.speed ?? prev.speed,
          simTime: p.simTime ?? prev.simTime,
          scenario: p.scenario ?? prev.scenario,
          activeFaults: p.activeFaults ?? prev.activeFaults,
          tickMs: p.tickMs ?? prev.tickMs,
          overallStatus: p.overallStatus ?? prev.overallStatus,
          Qreq: p.Qreq ?? prev.Qreq,
        }));
      }
    });
    socket.on("fan:updated", () => {
      mark();
      setEquipmentTick((t) => t + 1);
    });
    socket.on("door:updated", () => {
      mark();
      setEquipmentTick((t) => t + 1);
    });
    socket.on("regulator:updated", () => {
      mark();
      setEquipmentTick((t) => t + 1);
    });
    socket.on("fault:injected", (f) => {
      mark();
      setFaultTick((t) => t + 1);
      if (f) {
        setSim((prev) => ({
          ...prev,
          activeFaults: [...(prev.activeFaults || []), f.faultId || f.id || "fault"],
        }));
        pushToastRef.current(
          `Fault injected — ${f.name || f.faultId || "fault"}`,
          "warning",
          7000
        );
      }
    });
    socket.on("fault:recovered", (f) => {
      mark();
      setFaultTick((t) => t + 1);
      if (f) {
        setSim((prev) => ({
          ...prev,
          activeFaults: (prev.activeFaults || []).filter(
            (x) => x !== (f.faultId || f.id) && x?.faultId !== (f.faultId || f.id)
          ),
        }));
        pushToastRef.current(`Fault recovered — ${f.name || f.faultId || "fault"}`, "success", 5000);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  const value = useMemo(
    () => ({
      connected,
      lastMsgAt,
      readings,
      statuses,
      overallStatus,
      serverTime,
      recentAlerts,
      configTick,
      sim,
      faultTick,
      equipmentTick,
    }),
    [connected, lastMsgAt, readings, statuses, overallStatus, serverTime, recentAlerts, configTick, sim, faultTick, equipmentTick]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside RealtimeProvider");
  return ctx;
};

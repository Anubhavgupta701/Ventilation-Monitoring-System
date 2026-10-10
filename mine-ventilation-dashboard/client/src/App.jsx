import React, { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RealtimeProvider, useRealtime } from "./realtime/RealtimeContext";
import { ToastProvider, useToast } from "./ui/toast";
import { InspectorProvider, useInspector } from "./ui/InspectorContext";
import { Simulator } from "./lib/api";
import Layout from "./ui/Layout";
import CommandPalette from "./ui/CommandPalette";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import NetworkPage from "./pages/Network";
import SensorsPage from "./pages/Sensors";
import SensorDetail from "./pages/SensorDetail";
import FansPage from "./pages/Fans";
import AirwaysPage from "./pages/Airways";
import AlertsPage from "./pages/Alerts";
import SimulationPage from "./pages/Simulation";
import AnalyticsPage from "./pages/Analytics";
import CalculatorPage from "./pages/Calculator";
import DatasetPage from "./pages/DatasetAnalysis";
import ThresholdsPage from "./pages/Thresholds";
import ReportsPage from "./pages/Reports";
import AuditLogPage from "./pages/AuditLog";
import SettingsPage from "./pages/Settings";
import UsersPage from "./pages/Users";

const LAYER_IDS = ["AIRFLOW", "PRESSURE", "CH4", "CO", "CO2", "O2", "TEMPERATURE", "HUMIDITY"];

/* Redirects unauthenticated visitors to /login, remembering where they came from. */
function RequireAuth({ children }) {
  const { isAuthed } = useAuth();
  const location = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/* Hides whole routes by minimum role. */
function RequireRole({ minRole, children }) {
  const { hasRole } = useAuth();
  if (!hasRole(minRole)) {
    return <Navigate to="/overview" replace />;
  }
  return children;
}

/* Ctrl+K palette state, shared between Layout's button and the palette itself. */
const PaletteContext = React.createContext({ openPalette: () => {}, closePalette: () => {} });
export const usePalette = () => React.useContext(PaletteContext);

/* Global keyboard shortcuts for the control room.
   - Ctrl/Cmd+K: command palette
   - Space: pause / resume simulation (operator+)
   - R: reset simulation (operator+, confirmed)
   - F: fit map view
   - 1–8: jump to map layer
   - Esc: close palette / clear inspector selection
   Never fires while typing in an input, textarea, select or contentEditable. */
function GlobalShortcuts() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { pushToast, pushApiError } = useToast();
  const { sim } = useRealtime();
  const { clear } = useInspector();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const toggleSim = useCallback(async () => {
    if (!hasRole("Operator")) return;
    const paused = sim.paused ?? !sim.running;
    try {
      if (paused) {
        await Simulator.resume();
        pushToast("Simulation resumed.", "success");
      } else {
        await Simulator.pause();
        pushToast("Simulation paused.", "success");
      }
    } catch (e) {
      pushApiError(e, "Could not change simulation state.");
    }
  }, [hasRole, sim.paused, sim.running, pushToast, pushApiError]);

  const resetSim = useCallback(async () => {
    if (!hasRole("Operator")) return;
    if (!window.confirm("Reset the simulation? Active faults clear and the sim clock restarts.")) return;
    try {
      await Simulator.reset();
      pushToast("Simulation reset.", "success");
    } catch (e) {
      pushApiError(e, "Could not reset the simulation.");
    }
  }, [hasRole, pushToast, pushApiError]);

  useEffect(() => {
    const typing = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const handler = (e) => {
      const modK = (e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K");
      if (modK) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing(e.target)) return;

      if (e.key === "Escape") {
        setPaletteOpen(false);
        clear();
        return;
      }
      if (paletteOpen) return; // palette has its own arrow-key handling

      if (e.key === " ") {
        e.preventDefault();
        toggleSim();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "r") {
        resetSim();
        return;
      }
      if (k === "f") {
        window.dispatchEvent(new CustomEvent("map:fit"));
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 8) {
        navigate("/network", { state: { layer: LAYER_IDS[n - 1] } });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toggleSim, resetSim, clear, paletteOpen]);

  return (
    <PaletteContext.Provider value={{ openPalette, closePalette }}>
      <Layout onOpenPalette={openPalette} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </PaletteContext.Provider>
  );
}

function AppRoutes() {
  return (
    <>
      <SessionWatcher />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <RealtimeProvider>
                <InspectorProvider>
                  <GlobalShortcuts />
                </InspectorProvider>
              </RealtimeProvider>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="map" element={<Navigate to="/network" replace />} />
          <Route path="sensors" element={<SensorsPage />} />
          <Route path="sensors/:id" element={<SensorDetail />} />
          <Route path="fans" element={<FansPage />} />
          <Route path="airways" element={<AirwaysPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="simulation" element={<SimulationPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="calculator" element={<CalculatorPage />} />
          <Route path="dataset" element={<DatasetPage />} />
          <Route path="thresholds" element={<ThresholdsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route
            path="audit"
            element={
              <RequireRole minRole="Operator">
                <AuditLogPage />
              </RequireRole>
            }
          />
          <Route
            path="settings"
            element={
              <RequireRole minRole="Officer">
                <SettingsPage />
              </RequireRole>
            }
          />
          <Route
            path="users"
            element={
              <RequireRole minRole="Admin">
                <UsersPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </>
  );
}

/* A dead server-side token boots the user back to /login with an explanation. */
function SessionWatcher() {
  const { clearSession } = useAuth();
  const { pushToast } = useToast();
  useEffect(() => {
    const handler = () => {
      clearSession();
      pushToast("Session expired — please sign in again.", "warning");
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [clearSession, pushToast]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

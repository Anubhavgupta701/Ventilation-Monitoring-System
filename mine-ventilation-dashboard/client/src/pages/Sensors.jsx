import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sensors as SensorsApi } from "../lib/api";
import { useRealtime } from "../realtime/RealtimeContext";
import { useToast } from "../ui/toast";
import { LoadingPanel, PageHeader, StatePanel, StatusPill } from "../ui/primitives";
import { ageOf, fmtNum, locationLabel } from "../lib/format";
import { IconInfo } from "../ui/icons";

export default function SensorsPage() {
  const { pushApiError } = useToast();
  const { statuses, readings } = useRealtime();
  const navigate = useNavigate();
  const [sensors, setSensors] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [locFilter, setLocFilter] = useState("ALL");

  const load = useCallback(async () => {
    try {
      const d = await SensorsApi.list();
      setSensors(Array.isArray(d) ? d : d?.data || []);
      setError(null);
    } catch (err) {
      setError(err);
      if (loading) pushApiError(err, "Failed to load sensors.");
    } finally {
      setLoading(false);
    }
  }, [loading, pushApiError]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const locTypes = useMemo(() => {
    const s = new Set((sensors || []).map((x) => x.locationType).filter(Boolean));
    return [...s];
  }, [sensors]);

  const filtered = useMemo(() => {
    return (sensors || []).filter((s) => {
      if (locFilter !== "ALL" && s.locationType !== locFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          s.sensorId.toLowerCase().includes(q) ||
          (s.name || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sensors, query, locFilter]);

  const healthOf = (s) => {
    const st = statuses[s.sensorId]?.status || s.status || "OFFLINE";
    const seen = statuses[s.sensorId]?.ts || s.lastSeenAt;
    const r = readings[s.sensorId];
    const comms = s.comms || r?.comms || (st === "OFFLINE" ? "LOST" : "OK");
    return { st, seen, comms, signal: s.signalDbm ?? r?.signalDbm ?? null, battery: s.batteryPct ?? r?.batteryPct ?? null };
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Instrumentation" scriptWord="Sensor" title="stations" />
        <LoadingPanel />
      </>
    );
  }

  if (error && !sensors) {
    return (
      <>
        <PageHeader eyebrow="Instrumentation" scriptWord="Sensor" title="stations" />
        <StatePanel title="Sensors unavailable" requestId={error.requestId} onRetry={load} icon={<IconInfo size={30} />}>
          {error.message}
        </StatePanel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Instrumentation"
        scriptWord="Sensor"
        title="stations"
        lede="Every monitoring station — health, comms, location class and last-seen age. Select a station for live values, calibration metadata and trend charts."
      />

      <div className="map-toolbar">
        <input
          type="text"
          placeholder="Search by id or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
          aria-label="Search sensors"
        />
        <div className="chip-row">
          <button className={`chip${locFilter === "ALL" ? " active" : ""}`} onClick={() => setLocFilter("ALL")}>
            All
          </button>
          {locTypes.map((lt) => (
            <button
              key={lt}
              className={`chip${locFilter === lt ? " active" : ""}`}
              onClick={() => setLocFilter(lt)}
              title={locationLabel(lt)}
            >
              {lt.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Station</th>
              <th>Name</th>
              <th>Status</th>
              <th>Comms</th>
              <th className="num">Signal</th>
              <th className="num">Battery</th>
              <th>Location class</th>
              <th className="num">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const h = healthOf(s);
              return (
                <tr key={s.sensorId} className="clickable" onClick={() => navigate(`/sensors/${s.sensorId}`)}>
                  <td className="mono" style={{ fontWeight: 700, color: "var(--accent)" }}>
                    {s.sensorId}
                  </td>
                  <td>{s.name}</td>
                  <td><StatusPill status={h.st} /></td>
                  <td>
                    {h.comms === "LOST" ? (
                      <span className="pill crit">comm lost</span>
                    ) : (
                      <span className="pill ok">ok</span>
                    )}
                  </td>
                  <td className="num mono">{h.signal != null ? `${fmtNum(h.signal, 0)} dBm` : "—"}</td>
                  <td className="num mono">{h.battery != null ? `${fmtNum(h.battery, 0)} %` : "—"}</td>
                  <td style={{ fontSize: 12.5 }}>{locationLabel(s.locationType)}</td>
                  <td className="num mono" style={{ fontSize: 12 }}>
                    {ageOf(h.seen) ? `${ageOf(h.seen)} ago` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <div className="state-panel section-gap">
          <h3>No stations match</h3>
          <p>Try clearing the search or choosing a different location class.</p>
        </div>
      ) : null}
    </>
  );
}

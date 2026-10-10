import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "../ui/toast";
import { Simulator } from "../lib/api";
import { fmtDateTimeIST } from "../lib/format";
import { IconPause, IconPlay, IconStepBack, IconStepFwd } from "../ui/icons";

/* Time machine: |◀ ◀ PLAY ▶ ▶| LIVE, −30/−15/NOW.
   Loads /simulator/snapshot?at= → parent renders the historical state.
   Parent owns atIso (null = live). */
export default function TimeMachine({ atIso, onSelect }) {
  const { pushApiError, pushToast } = useToast();
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  const [history, setHistory] = useState([]); // snapshot index [{at}]
  const [busy, setBusy] = useState(false);

  const loadIndex = useCallback(async () => {
    try {
      const d = await Simulator.snapshots({ limit: 200 });
      // Server shape: { data: [snapshots with .ts], total }. Accept a few
      // legacy shapes too.
      const raw = Array.isArray(d) ? d : d?.data || d?.snapshots || [];
      setHistory(
        raw
          .map((s) => ({ at: typeof s === "string" ? s : s?.at || s?.ts }))
          .filter((s) => s.at)
      );
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  const goAt = useCallback(
    async (at) => {
      setBusy(true);
      try {
        await Simulator.snapshotAt(at); // validates + warms the server cache; parent renders from `at`
        onSelect(at);
        pushToast(`Viewing snapshot ${fmtDateTimeIST(at)}.`, "success");
      } catch (e) {
        pushApiError(e, "Could not load that snapshot.");
      } finally {
        setBusy(false);
      }
    },
    [onSelect, pushApiError, pushToast]
  );

  const goLive = useCallback(() => {
    setPlaying(false);
    onSelect(null);
  }, [onSelect]);

  const step = useCallback(
    (dir) => {
      if (!history.length) return;
      const sorted = [...history].sort((a, b) => new Date(a.at) - new Date(b.at));
      let i = sorted.findIndex((s) => s.at === atIso);
      if (i === -1) i = dir > 0 ? -1 : sorted.length;
      const next = sorted[Math.min(sorted.length - 1, Math.max(0, i + dir))];
      if (next) {
        setPlayIdx(sorted.indexOf(next));
        goAt(next.at);
      }
    },
    [history, atIso, goAt]
  );

  /* Playback: step through snapshots every 2.5 s. */
  useEffect(() => {
    if (!playing || !history.length) return;
    const t = setInterval(() => {
      setPlayIdx((i) => {
        const sorted = [...history].sort((a, b) => new Date(a.at) - new Date(b.at));
        const next = Math.min(sorted.length - 1, i + 1);
        const s = sorted[next];
        if (s && s.at !== atIso) goAt(s.at);
        if (next >= sorted.length - 1) setPlaying(false);
        return next;
      });
    }, 2500);
    return () => clearInterval(t);
  }, [playing, history]); // eslint-disable-line react-hooks/exhaustive-deps

  const quick = (mins) => {
    const at = new Date(Date.now() - mins * 60000).toISOString();
    goAt(at);
  };

  const isHist = !!atIso;

  return (
    <div className={`tm-bar${isHist ? " tm-hist" : ""}`} role="group" aria-label="Time machine">
      <span className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--text-3)" }}>
        TIME MACHINE
      </span>
      <div className="transport">
        <button className="tbtn" title="Step back" disabled={busy || !history.length} onClick={() => step(-1)}>
          <IconStepBack size={13} />
        </button>
        <button className="tbtn" title="Step forward" disabled={busy || !history.length} onClick={() => step(1)}>
          <IconStepFwd size={13} />
        </button>
        <button
          className={`tbtn ${playing ? "warn-active" : ""}`}
          title={playing ? "Pause playback" : "Play history"}
          disabled={busy || !history.length}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <IconPause size={13} /> : <IconPlay size={13} />} {playing ? "Playing" : "Play"}
        </button>
      </div>
      <div className="chip-row">
        <button className="chip" disabled={busy} onClick={() => quick(30)} title="Jump 30 minutes back">
          −30m
        </button>
        <button className="chip" disabled={busy} onClick={() => quick(15)} title="Jump 15 minutes back">
          −15m
        </button>
        <button
          className={`chip${!isHist ? " active" : ""}`}
          disabled={busy}
          onClick={goLive}
          title="Return to live"
        >
          LIVE
        </button>
      </div>
      <div className="tm-clock">
        {isHist
          ? fmtDateTimeIST(atIso)
          : history.length
            ? fmtDateTimeIST(
                [...history].sort((a, b) => new Date(b.at) - new Date(a.at))[0].at
              )
            : "—"}
      </div>
      {isHist ? (
        <span className="pill sim" title="Historical snapshot — controls are disabled">
          historical view
        </span>
      ) : null}
      {!history.length ? (
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          no snapshots indexed yet
        </span>
      ) : null}
    </div>
  );
}

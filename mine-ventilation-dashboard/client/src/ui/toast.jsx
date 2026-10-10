import React, { createContext, useCallback, useContext, useState } from "react";

/* Toasts surface the API error envelope's `message` to the user. */
const ToastContext = createContext(null);

let toastSeq = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message, kind = "info", ms = 5200) => {
      const id = toastSeq++;
      setToasts((prev) => [...prev.slice(-4), { id, message, kind }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );

  const pushApiError = useCallback(
    (err, fallback = "Something went wrong.") => {
      const msg = err && err.message ? err.message : fallback;
      const kind = err && (err.status === 403 || err.status === 401) ? "warning" : "critical";
      pushToast(msg, kind);
    },
    [pushToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, pushToast, pushApiError, dismiss }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role="status">
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
};

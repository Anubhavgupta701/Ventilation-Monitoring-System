import React, { createContext, useContext, useState } from "react";

const InspectorContext = createContext(null);

export function InspectorProvider({ children }) {
  const [sel, setSel] = useState(null);
  const select = (kind, id, data) => setSel({ kind, id, data });
  const clear = () => setSel(null);

  return (
    <InspectorContext.Provider value={{ sel, select, clear }}>
      {children}
    </InspectorContext.Provider>
  );
}

export function useInspector() {
  const context = useContext(InspectorContext);
  if (!context) throw new Error("useInspector must be used within InspectorProvider");
  return context;
}
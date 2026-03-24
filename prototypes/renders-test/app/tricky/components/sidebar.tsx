"use client";

import { useState } from "react";
import { StatusBadge } from "./status-badge";
import { useWindowSize } from "../hooks/use-window-size";

const STATUSES = [
  { label: "Active", color: "#22c55e" },
  { label: "Pending", color: "#f59e0b" },
  { label: "Shipped", color: "#3b82f6" },
  { label: "Returned", color: "#ef4444" },
  { label: "Archived", color: "#6b7280" },
];

// RED HERRING: Uses useWindowSize (which looks suspicious) and creates
// inline objects for StatusBadge (which looks like a memo-defeating pattern).
// But neither is the actual performance problem — this sidebar barely
// re-renders because window resize events are rare.
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { width } = useWindowSize();

  if (collapsed) {
    return (
      <aside style={{ width: 40, padding: 8 }}>
        <button onClick={() => setCollapsed(false)}>→</button>
      </aside>
    );
  }

  return (
    <aside style={{ width: 220, padding: 16, borderRight: "1px solid #eee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <strong>Sidebar</strong>
        <button onClick={() => setCollapsed(true)}>←</button>
      </div>
      <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
        Window: {width}px
      </div>
      <h4>Order Status</h4>
      {STATUSES.map((s) => (
        <div key={s.label} style={{ marginBottom: 8 }}>
          <StatusBadge config={{ label: s.label, color: s.color }} />
        </div>
      ))}
    </aside>
  );
}

"use client";

import { useCursorTracker } from "../hooks/use-cursor-tracker";

export function CursorIndicator() {
  const { x, y } = useCursorTracker();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        padding: "4px 8px",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        borderRadius: 4,
        fontSize: 11,
        zIndex: 1000,
      }}
    >
      {x}, {y}
    </div>
  );
}

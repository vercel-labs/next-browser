"use client";

import { memo } from "react";

// RED HERRING: Not wrapped in memo, receives object prop.
// A code reviewer might flag this. But it's only rendered 5 times
// (in the sidebar) and its parent doesn't re-render often.
export function StatusBadge({ config }: { config: { label: string; color: string } }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        background: config.color,
        color: "#fff",
        fontSize: 12,
      }}
    >
      {config.label}
    </span>
  );
}

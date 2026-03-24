"use client";

import { useLiveClock } from "../hooks/use-live-clock";

// RED HERRING: Updates every second but is cheap to render.
// A code reviewer might flag this as "updating every second = bad"
// but it's a single DOM update — negligible cost.
export function ClockWidget() {
  const time = useLiveClock();
  return (
    <div style={{ padding: 8, background: "#f0f0f0", borderRadius: 4 }}>
      {time.toLocaleTimeString()}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

// RED HERRING: Updates every second. Looks like it could cause perf issues.
// But it only re-renders its one consumer (ClockWidget) which is cheap.
export function useLiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}

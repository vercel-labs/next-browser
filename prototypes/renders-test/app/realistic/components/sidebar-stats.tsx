"use client";

import { useMemo } from "react";
import { useApp } from "../contexts/app-context";
import { useAnalytics } from "../hooks/use-analytics";

export function SidebarStats() {
  const { theme } = useApp();
  useAnalytics("SidebarStats");

  const total = useMemo(() => {
    let t = 0;
    for (let i = 0; i < 10000; i++) t += Math.sin(i) * Math.cos(i);
    return t;
  }, []);

  return (
    <aside
      style={{
        width: 200,
        padding: 16,
        background: theme === "dark" ? "#444" : "#fafafa",
        color: theme === "dark" ? "#fff" : "#000",
      }}
    >
      <h4>Stats</h4>
      <p>Active: 67</p>
      <p>Completed: 66</p>
      <p>Pending: 67</p>
      <p>Computed: {total.toFixed(2)}</p>
    </aside>
  );
}

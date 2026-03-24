"use client";

import { Sidebar } from "./components/sidebar";
import { MainContent } from "./components/main-content";
import { ClockWidget } from "./components/clock-widget";

export default function TrickyDashboard() {
  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 16,
          borderBottom: "1px solid #eee",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>Product Dashboard</h1>
        <ClockWidget />
      </header>
      <div style={{ display: "flex" }}>
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
}

"use client";

import { useApp } from "../contexts/app-context";
import { useNotifications } from "../contexts/notifications-context";

export function Header() {
  const { user, theme, setTheme } = useApp();
  const notifications = useNotifications();

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: 16,
        background: theme === "dark" ? "#333" : "#f0f0f0",
        color: theme === "dark" ? "#fff" : "#000",
      }}
    >
      <div>
        <strong>Dashboard</strong> — {user.name} ({user.role})
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <span>Notifications: {notifications.length}</span>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          Toggle {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}

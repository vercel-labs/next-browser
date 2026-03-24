"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Notification = { id: number; text: string; time: number };

const NotificationsContext = createContext<Notification[]>([]);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Simulate polling — new notification every 2 seconds
  useEffect(() => {
    let id = 0;
    const interval = setInterval(() => {
      id++;
      setNotifications((prev) => [
        ...prev.slice(-9),
        { id, text: `Notification #${id}`, time: Date.now() },
      ]);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <NotificationsContext.Provider value={notifications}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}

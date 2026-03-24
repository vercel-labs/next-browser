"use client";

import { AppProvider } from "./contexts/app-context";
import { NotificationsProvider } from "./contexts/notifications-context";
import { Header } from "./components/header";
import { SearchBar } from "./components/search-bar";
import { FiltersPanel } from "./components/filters-panel";
import { DataTable } from "./components/data-table";
import { SidebarStats } from "./components/sidebar-stats";

export default function RealisticDashboard() {
  return (
    <AppProvider>
      <NotificationsProvider>
        <div style={{ fontFamily: "sans-serif" }}>
          <Header />
          <div style={{ display: "flex" }}>
            <div style={{ flex: 1 }}>
              <SearchBar />
              <FiltersPanel />
              <DataTable />
            </div>
            <SidebarStats />
          </div>
        </div>
      </NotificationsProvider>
    </AppProvider>
  );
}

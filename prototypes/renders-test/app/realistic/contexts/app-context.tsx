"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

type AppStaticState = {
  theme: "light" | "dark";
  user: { name: string; role: string };
};

type AppStaticContextValue = AppStaticState & {
  setTheme: (t: "light" | "dark") => void;
};

type Filters = { status: string; priority: string };

type SearchContextValue = {
  searchQuery: string;
  filters: Filters;
  setSearchQuery: (q: string) => void;
  setFilters: (f: Filters) => void;
};

const AppContext = createContext<AppStaticContextValue | null>(null);
const SearchContext = createContext<SearchContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [user] = useState({ name: "Alice", role: "admin" });
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({ status: "all", priority: "all" });

  const setTheme = useCallback((t: "light" | "dark") => setThemeState(t), []);

  const appValue = useMemo(
    () => ({ theme, user, setTheme }),
    [theme, user, setTheme],
  );

  const searchValue = useMemo(
    () => ({ searchQuery, filters, setSearchQuery, setFilters }),
    [searchQuery, filters],
  );

  return (
    <AppContext.Provider value={appValue}>
      <SearchContext.Provider value={searchValue}>
        {children}
      </SearchContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be inside AppProvider");
  return ctx;
}

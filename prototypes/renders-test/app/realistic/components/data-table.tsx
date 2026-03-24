"use client";

import { useMemo, memo } from "react";
import { useSearch } from "../contexts/app-context";
import { useAnalytics } from "../hooks/use-analytics";

type Item = {
  id: number;
  name: string;
  status: string;
  priority: string;
  value: number;
};

// Generate 200 items
const ITEMS: Item[] = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  status: ["active", "completed", "pending"][i % 3],
  priority: ["high", "medium", "low"][i % 3],
  value: Math.round(Math.random() * 10000),
}));

const DataRow = memo(function DataRow({ item }: { item: Item }) {
  useAnalytics("DataRow");

  // Simulate expensive render — formatting, calculations
  const formatted = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 500; i++) sum += Math.sqrt(item.value + i);
    return {
      name: item.name,
      status: item.status.toUpperCase(),
      priority: `P:${item.priority}`,
      computed: sum.toFixed(2),
    };
  }, [item]);

  return (
    <tr>
      <td>{formatted.name}</td>
      <td>{formatted.status}</td>
      <td>{formatted.priority}</td>
      <td>{formatted.computed}</td>
    </tr>
  );
});

export function DataTable() {
  const { searchQuery, filters } = useSearch();
  useAnalytics("DataTable");

  const filtered = useMemo(() => {
    let result = ITEMS;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => item.name.toLowerCase().includes(q));
    }
    if (filters.status !== "all") {
      result = result.filter((item) => item.status === filters.status);
    }
    if (filters.priority !== "all") {
      result = result.filter((item) => item.priority === filters.priority);
    }
    return result;
  }, [searchQuery, filters]);

  return (
    <div style={{ padding: 16 }}>
      <h3>Results ({filtered.length})</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Priority</th>
            <th style={{ textAlign: "left" }}>Computed</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((item) => (
            <DataRow key={item.id} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

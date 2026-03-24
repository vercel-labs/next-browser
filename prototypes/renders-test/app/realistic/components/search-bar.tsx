"use client";

import { useSearch } from "../contexts/app-context";

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useSearch();

  return (
    <div style={{ padding: 16 }}>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search items..."
        style={{ width: 300, padding: 8 }}
      />
    </div>
  );
}

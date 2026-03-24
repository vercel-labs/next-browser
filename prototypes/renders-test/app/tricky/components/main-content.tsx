"use client";

import { useState } from "react";
import { ProductGrid } from "./product-grid";
import { CursorIndicator } from "./cursor-indicator";

export function MainContent() {
  const [filter, setFilter] = useState("all");

  return (
    <div style={{ flex: 1, padding: 16 }}>
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        {["all", "Electronics", "Books", "Clothing", "Home", "Sports"].map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                padding: "4px 12px",
                background: filter === cat ? "#3b82f6" : "#e5e7eb",
                color: filter === cat ? "#fff" : "#000",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {cat}
            </button>
          ),
        )}
      </div>
      <ProductGrid filter={filter} />
      <CursorIndicator />
    </div>
  );
}

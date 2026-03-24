"use client";

import { memo, useMemo } from "react";
import { ProductCard } from "./product-card";

const PRODUCTS = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  price: Math.round(Math.random() * 200 * 100) / 100,
  category: ["Electronics", "Books", "Clothing", "Home", "Sports"][i % 5],
  rating: 1 + Math.random() * 4,
}));

// This component looks fine — products are static, no context dependency.
// But it re-renders because its PARENT (MainContent) re-renders on every
// mouse move due to useCursorTracker. The grid itself doesn't use the
// cursor data — it's a victim of parent re-rendering.
export const ProductGrid = memo(function ProductGrid({ filter }: { filter: string }) {
  const filtered = useMemo(() => {
    if (filter === "all") return PRODUCTS;
    return PRODUCTS.filter((p) => p.category === filter);
  }, [filter]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      {filtered.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
});

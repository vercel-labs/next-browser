"use client";

// Expensive card component — lots of DOM, formatting, style calculations
export function ProductCard({ product }: {
  product: { id: number; name: string; price: number; category: string; rating: number };
}) {
  // Simulate moderately expensive render
  let hash = 0;
  for (let i = 0; i < 200; i++) hash += Math.sqrt(product.price + i);

  const stars = "★".repeat(Math.round(product.rating)) +
    "☆".repeat(5 - Math.round(product.rating));

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 16,
        margin: 8,
        width: 200,
      }}
    >
      <h4 style={{ margin: "0 0 8px" }}>{product.name}</h4>
      <div style={{ color: "#666", fontSize: 12 }}>{product.category}</div>
      <div style={{ fontSize: 18, fontWeight: "bold", margin: "8px 0" }}>
        ${product.price.toFixed(2)}
      </div>
      <div style={{ color: "#f5a623" }}>{stars}</div>
      <div style={{ fontSize: 10, color: "#999" }}>hash: {hash.toFixed(0)}</div>
    </div>
  );
}

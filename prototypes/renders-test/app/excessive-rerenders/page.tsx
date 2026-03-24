"use client";

import { useState, useEffect } from "react";

function ExpensiveChild({ label }: { label: string }) {
  // Simulate expensive render work
  const items = Array(1000)
    .fill(0)
    .map((_, i) => `${label}-${i}`);
  return (
    <div>
      <strong>{label}</strong>: {items.length} items
    </div>
  );
}

function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCount((c) => c + 1), 200);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <h2>Count: {count}</h2>
      <ExpensiveChild label="Child A" />
      <ExpensiveChild label="Child B" />
      <ExpensiveChild label="Child C" />
      <ExpensiveChild label="Child D" />
      <ExpensiveChild label="Child E" />
    </div>
  );
}

export default function ExcessiveRerenders() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Excessive Re-renders</h1>
      <p>Counter increments every 200ms, forcing all children to re-render.</p>
      <Counter />
    </main>
  );
}

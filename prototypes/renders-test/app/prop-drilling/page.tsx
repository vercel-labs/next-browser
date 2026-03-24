"use client";

import { useState, useEffect, memo } from "react";

const MemoChild = memo(function MemoChild({ data }: { data: { value: number } }) {
  return <div>Value: {data.value}</div>;
});

const CHILD_DATA = { value: 42 };

function Parent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCount((c) => c + 1), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <h2>Parent renders: {count}</h2>
      <MemoChild data={CHILD_DATA} />
      <MemoChild data={CHILD_DATA} />
      <MemoChild data={CHILD_DATA} />
    </div>
  );
}

export default function PropDrilling() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Prop Drilling (Memo Fixed)</h1>
      <p>Parent passes a stable object reference, so React.memo correctly skips re-renders.</p>
      <Parent />
    </main>
  );
}

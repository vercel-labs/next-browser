"use client";

import { createContext, useContext, useState, useEffect } from "react";

const TimestampContext = createContext(0);

function Consumer({ id }: { id: number }) {
  const timestamp = useContext(TimestampContext);
  return (
    <div>
      Consumer {id}: {timestamp}
    </div>
  );
}

function Provider({ children }: { children: React.ReactNode }) {
  const [ts, setTs] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setTs(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  return (
    <TimestampContext.Provider value={ts}>{children}</TimestampContext.Provider>
  );
}

export default function ContextThrash() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Context Thrashing</h1>
      <p>Context updates every 100ms, causing all 10 consumers to re-render.</p>
      <Provider>
        <Consumer id={1} />
        <Consumer id={2} />
        <Consumer id={3} />
        <Consumer id={4} />
        <Consumer id={5} />
        <Consumer id={6} />
        <Consumer id={7} />
        <Consumer id={8} />
        <Consumer id={9} />
        <Consumer id={10} />
      </Provider>
    </main>
  );
}

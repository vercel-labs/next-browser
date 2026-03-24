"use client";

import { useState, useEffect } from "react";

// RED HERRING: This hook looks suspicious — subscribes to resize events.
// But resize events are rare during normal usage. Not the real problem.
export function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    function handleResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}

"use client";

import { useState, useEffect } from "react";

// THE REAL PROBLEM: This hook tracks mouse position on every mousemove.
// It causes the consuming component — and all its children — to re-render
// on every mouse movement (~60fps). But it's buried in a "use-cursor-tracker"
// name that sounds harmless, and it's consumed by a seemingly unrelated
// parent component.
export function useCursorTracker() {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      setPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return pos;
}

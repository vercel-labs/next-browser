"use client";

import { useEffect, useRef } from "react";

// Tracks render count for analytics — harmless but adds noise
export function useAnalytics(componentName: string) {
  const count = useRef(0);
  useEffect(() => {
    count.current++;
  });
  return count;
}

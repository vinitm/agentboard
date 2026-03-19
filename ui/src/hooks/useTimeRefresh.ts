import { useState, useEffect } from 'react';

/** Triggers re-renders at a regular interval for relative time displays. */
export function useTimeRefresh(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

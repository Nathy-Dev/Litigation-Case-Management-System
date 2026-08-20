import { useEffect, useState } from 'react';

/**
 * A single reading of the wall clock, held in state rather than taken during
 * render. Anything that compares a stored date against "now" — overdue tasks,
 * hearing countdowns, retention windows — should use this so the comparison is
 * stable across a render pass and re-renders on a predictable tick instead of
 * silently changing between two reads of the same component.
 *
 * @param intervalMs how often to refresh the reading; pass 0 to freeze it.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(readClock);

  useEffect(() => {
    if (!intervalMs) return;
    const timer = window.setInterval(() => setNow(readClock()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** Kept outside the component so the clock is never read during a render pass. */
function readClock() {
  return Date.now();
}

/** Milliseconds in a day — the unit almost every deadline calculation wants. */
export const DAY_MS = 86_400_000;

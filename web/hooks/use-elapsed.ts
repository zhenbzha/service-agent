import { useEffect, useState } from "react";

/**
 * Milliseconds from `since` to `until`. While `until` is unset the time runs on, and the
 * component re-renders every `intervalMs`.
 */
export function useElapsed(since: number | undefined, until: number | undefined, intervalMs = 1000): number {
  const running = since !== undefined && until === undefined;
  const [now, setNow] = useState(since ?? 0);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [running, intervalMs]);

  if (since === undefined) return 0;
  // Until the first tick, `now` can still be from before `since`.
  return Math.max(0, (until ?? now) - since);
}

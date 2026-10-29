import { useEffect, useState } from 'react';

/** Delivery promise shown after an order is confirmed. */
export const DELIVERY_WINDOW_MS = 10 * 60_000;

/**
 * Milliseconds left until the delivery promise, from the order's stored confirmation time.
 * Recomputed from the clock every tick, so refreshing, reopening the order or another device
 * all show the same remaining time; serverOffsetMs corrects for a wrong device clock.
 * Never negative; stops at 0. A missing timestamp (older orders) counts as already elapsed.
 */
export function useDeliveryCountdown(confirmedAt: string | null, serverOffsetMs: number): number {
  const parsed = confirmedAt ? Date.parse(confirmedAt) : Number.NaN;
  const deadline = Number.isNaN(parsed) ? null : parsed + DELIVERY_WINDOW_MS;

  const [remaining, setRemaining] = useState(() =>
    deadline === null ? 0 : Math.max(0, deadline - (Date.now() + serverOffsetMs))
  );

  useEffect(() => {
    const compute = () => (deadline === null ? 0 : Math.max(0, deadline - (Date.now() + serverOffsetMs)));
    setRemaining(compute());
    if (deadline === null) return;
    // Tick several times a second but only re-render when the displayed second changes.
    const timer = window.setInterval(() => {
      const next = compute();
      setRemaining((previous) => (Math.ceil(previous / 1000) === Math.ceil(next / 1000) ? previous : next));
      if (next <= 0) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline, serverOffsetMs]);

  return remaining;
}

/** MM:SS, rounding up so the display reads 10:00 at the start and 00:00 only at zero. */
export function formatCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

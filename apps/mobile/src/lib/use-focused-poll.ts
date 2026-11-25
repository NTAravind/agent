import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Runs `tick` immediately and then every `intervalMs`, with two guards the
 * ad-hoc poll loops kept missing:
 *
 * - **Focus-aware**: the loop exists only while the screen is focused, so a
 *   tab or a screen buried under a pushed one stops burning requests (chat's
 *   two loops used to keep polling while you were reading a run, and every
 *   background tab kept its intervals alive).
 * - **Never overlapping**: if a tick is still in flight when the timer fires,
 *   that tick is skipped. Responses therefore always land in order, so a slow
 *   fetch can't overwrite newer state with stale data.
 *
 * `tick` is read through a ref, so callers may pass a fresh closure without
 * restarting the interval. Errors are swallowed — a throwing tick must not
 * kill the loop (each caller already handles its own failures).
 *
 * @param enabled  When false the loop is torn down (e.g. no live run to watch).
 * @param immediate  Set false when the screen already loads on focus, to avoid
 *                   fetching twice on entry.
 */
export function useFocusedPoll(
  tick: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  immediate = true,
): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let inFlight = false;

      const run = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          await tickRef.current();
        } catch {
          // Transient — the next tick retries.
        } finally {
          inFlight = false;
        }
      };

      const timer = setInterval(() => void run(), intervalMs);
      if (immediate) void run();
      return () => clearInterval(timer);
    }, [enabled, intervalMs, immediate]),
  );
}

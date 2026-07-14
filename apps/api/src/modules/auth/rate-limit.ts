// Hand-rolled fixed-window rate limiter (ADR-0007: auth mechanics
// implemented, not configured). In-memory per-IP is deliberate at
// single-user-localhost scale; state resetting on API restart is DISMISSED
// as acceptable (ratified 2026-07-13). The injectable clock keeps tests
// fully deterministic — no timers, no sleeps.

export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets — the 429 retry-after value. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export function createFixedWindowRateLimiter(options: {
  maxAttempts: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { maxAttempts, windowMs, now = Date.now } = options;
  const windows = new Map<string, { windowStart: number; count: number }>();

  return {
    check(key) {
      const at = now();
      // Prune stale entries so the map can't grow unboundedly across keys.
      for (const [k, w] of windows) {
        if (at - w.windowStart >= windowMs) windows.delete(k);
      }
      const window = windows.get(key);
      if (!window) {
        windows.set(key, { windowStart: at, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      window.count += 1;
      if (window.count > maxAttempts) {
        const retryAfterSeconds = Math.ceil((window.windowStart + windowMs - at) / 1000);
        return { allowed: false, retryAfterSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

import { describe, expect, it } from 'vitest';

import { createFixedWindowRateLimiter } from './rate-limit.ts';

// Injectable clock = fully deterministic: no timers, no sleeps, no flakes.
function createFakeClock(start = 1_000_000) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

const WINDOW_MS = 15 * 60_000;

function createLimiter(clock = createFakeClock()) {
  return {
    clock,
    limiter: createFixedWindowRateLimiter({ maxAttempts: 10, windowMs: WINDOW_MS, now: clock.now }),
  };
}

describe('fixed-window rate limiter', () => {
  it('allows up to the limit and blocks the attempt after it', () => {
    const { limiter } = createLimiter();
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('127.0.0.1').allowed).toBe(true);
    }
    const blocked = limiter.check('127.0.0.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(WINDOW_MS / 1000);
  });

  it('reports a shrinking retry-after as the window ages', () => {
    const { clock, limiter } = createLimiter();
    for (let i = 0; i < 10; i++) limiter.check('127.0.0.1');
    clock.advance(5 * 60_000);
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });

  it('resets once the window has fully elapsed', () => {
    const { clock, limiter } = createLimiter();
    for (let i = 0; i < 11; i++) limiter.check('127.0.0.1');
    expect(limiter.check('127.0.0.1').allowed).toBe(false);
    clock.advance(WINDOW_MS);
    expect(limiter.check('127.0.0.1').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const { limiter } = createLimiter();
    for (let i = 0; i < 11; i++) limiter.check('10.0.0.1');
    expect(limiter.check('10.0.0.1').allowed).toBe(false);
    expect(limiter.check('10.0.0.2').allowed).toBe(true);
  });
});

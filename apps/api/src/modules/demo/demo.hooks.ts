import { type FastifyInstance } from 'fastify';

import { MUTATING_METHODS } from '../auth/auth.hooks.ts';
import { createFixedWindowRateLimiter } from '../auth/rate-limit.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Marks a route as an LLM-draft POST (M10-03). In DEMO_MODE these return
     * DEMO_DISABLED (403) instead of reaching the provider: the demo is keyless
     * by decision and their outputs are pre-generated (seeded fixtures). The
     * marked-route set is a pinned gate - see the llmDraft pin test.
     */
    llmDraft?: boolean;
  }
}

/**
 * Policy refusal (403), distinct from the misconfiguration 503
 * LLM_NOT_CONFIGURED: an LLM-draft action was invoked on a keyless demo
 * instance, where those features are pre-generated rather than live.
 */
export class DemoDisabledError extends Error {
  readonly statusCode = 403;
  readonly code = 'DEMO_DISABLED';
  constructor() {
    super(
      'this action is disabled in the demo - its results are pre-generated (the demo is keyless)',
    );
  }
}

/**
 * When DEMO_MODE is on, every route marked `config: { llmDraft: true }` returns
 * DEMO_DISABLED instead of calling the provider. Registered AFTER the auth guard
 * so an unauthenticated caller still gets 401 first - a policy refusal is only
 * shown to callers who cleared authentication. When DEMO_MODE is off no hook is
 * added at all, so non-demo behavior is byte-for-byte unchanged.
 */
export function registerDemoDisabledGuard(
  app: FastifyInstance,
  options: { demoMode: boolean },
): void {
  if (!options.demoMode) return;
  // Promise-style hook (a sync onRequest hook hangs this Fastify setup), but it
  // has no awaitable work - an await-less `async` would trip require-await. So
  // return a resolved promise on the pass paths and throw synchronously on the
  // block path (Fastify catches the throw and maps DemoDisabledError to its 403,
  // like every other route-level guard error).
  app.addHook('onRequest', (request) => {
    if (request.is404 || request.routeOptions.config?.llmDraft !== true) return Promise.resolve();
    throw new DemoDisabledError();
  });
}

// Generous for a human visitor, hostile to scripts. In-memory per-process is
// correct here: one container, nightly reset, abuse-throttling not accounting.
// The M10-05 ADR can revise these with reasons.
export const DEMO_MUTATION_RATE_LIMIT_MAX = 60;
export const DEMO_MUTATION_RATE_LIMIT_WINDOW_MS = 10 * 60_000;

/**
 * When DEMO_MODE is on, throttle mutating requests per client IP (reusing the
 * hand-rolled login limiter engine - no new dep). POST /auth/login is exempt:
 * it has its own stricter limiter and must not be double-charged. Registered
 * after the auth guard so a 401 stays a 401 (only authorized mutations consume
 * budget; the login exemption makes order-vs-login moot). Reads are unlimited.
 * Not registered at all when DEMO_MODE is off, so non-demo behavior is unchanged.
 */
export function registerDemoRateLimit(app: FastifyInstance, options: { demoMode: boolean }): void {
  if (!options.demoMode) return;
  const limiter = createFixedWindowRateLimiter({
    maxAttempts: DEMO_MUTATION_RATE_LIMIT_MAX,
    windowMs: DEMO_MUTATION_RATE_LIMIT_WINDOW_MS,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.is404) return;
    if (!MUTATING_METHODS.has(request.method)) return;
    if (request.method === 'POST' && request.routeOptions.url === '/auth/login') return;
    const decision = limiter.check(request.ip);
    if (!decision.allowed) {
      return reply
        .header('retry-after', decision.retryAfterSeconds)
        .code(429)
        .send({
          error: { code: 'RATE_LIMITED', message: 'too many requests - the demo is rate-limited' },
        });
    }
  });
}

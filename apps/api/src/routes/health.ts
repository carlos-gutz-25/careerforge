import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import packageJson from '../../package.json' with { type: 'json' };

// Amplification cap (M13-04, AC 4): /health/ready is public + unauthenticated
// and does a DB round-trip, so a hammer could otherwise become one DB ping per
// request. The readiness verdict is memoized for this window: calls inside it
// share ONE result, and because the in-flight promise itself is cached,
// concurrent callers single-flight onto the same ping too. A module constant,
// not an env var (one less variable to misconfigure - disclosed decision D3).
const READINESS_CACHE_MS = 1500;

// Factory (matches the other route modules): `demoMode` reflects env.DEMO_MODE
// so M10-04's banner/prefill and the M10-08 smoke can tell a demo instance from
// a real one without a new route (ADR-0007); `checkReady` is the DB liveness
// probe, injected by app.ts so this route never imports packages/db (D4).
export const healthRoutes =
  (deps: { demoMode: boolean; checkReady: () => Promise<boolean> }): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    // public: liveness must not require a session (ADR-0007 allowlist).
    app.get(
      '/health',
      {
        config: { public: true },
        schema: {
          response: {
            200: z.object({ status: z.literal('ok'), version: z.string(), demo: z.boolean() }),
          },
        },
      },
      () => ({ status: 'ok' as const, version: packageJson.version, demo: deps.demoMode }),
    );

    let cached: { at: number; verdict: Promise<boolean> } | undefined;
    const readinessVerdict = (): Promise<boolean> => {
      const now = Date.now();
      if (cached && now - cached.at < READINESS_CACHE_MS) return cached.verdict;
      const verdict = deps.checkReady();
      cached = { at: now, verdict };
      return verdict;
    };

    // public: monitors/smokes must probe readiness without a session
    // (ADR-0007 allowlist). Unlike /health (process liveness), this reports
    // whether the DATABASE answers, so an orchestrator pointed at /health is
    // never restarted by a DB blip. The 503 body is a sanitized constant - no
    // DB error detail ever reaches the wire (checkReady swallows it).
    app.get(
      '/health/ready',
      {
        config: { public: true },
        schema: {
          response: {
            200: z.object({ status: z.literal('ready') }),
            503: z.object({ status: z.literal('unavailable') }),
          },
        },
      },
      async (_request, reply) => {
        const ready = await readinessVerdict();
        reply.code(ready ? 200 : 503);
        return ready ? { status: 'ready' as const } : { status: 'unavailable' as const };
      },
    );
    done();
  };

import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import packageJson from '../../package.json' with { type: 'json' };

// Factory (matches the other route modules): the `demo` field reflects
// env.DEMO_MODE so M10-04's banner/prefill and the M10-08 smoke can tell a demo
// instance from a real one without a new route (ADR-0007).
export const healthRoutes =
  (deps: { demoMode: boolean }): FastifyPluginCallbackZod =>
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
    done();
  };

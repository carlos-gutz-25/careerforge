import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import packageJson from '../../package.json' with { type: 'json' };

export const healthRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  // public: liveness must not require a session (ADR-0007 allowlist).
  app.get(
    '/health',
    {
      config: { public: true },
      schema: {
        response: { 200: z.object({ status: z.literal('ok'), version: z.string() }) },
      },
    },
    () => ({ status: 'ok' as const, version: packageJson.version }),
  );
  done();
};

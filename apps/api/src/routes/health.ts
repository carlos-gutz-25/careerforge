import { type FastifyPluginCallback } from 'fastify';

import packageJson from '../../package.json' with { type: 'json' };

export const healthRoutes: FastifyPluginCallback = (app, _opts, done) => {
  // public: liveness must not require a session (ADR-0007 allowlist).
  app.get('/health', { config: { public: true } }, () => ({
    status: 'ok',
    version: packageJson.version,
  }));
  done();
};

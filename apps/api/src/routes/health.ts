import { type FastifyPluginCallback } from 'fastify';

import packageJson from '../../package.json' with { type: 'json' };

export const healthRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/health', () => ({ status: 'ok', version: packageJson.version }));
  done();
};

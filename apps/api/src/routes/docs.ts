import fastifySwaggerUi from '@fastify/swagger-ui';
import { type FastifyPluginAsync } from 'fastify';

/**
 * Interactive API docs at /docs, generated from the route zod schemas
 * (M0-09). Registered by app.ts ONLY outside production — in production
 * these routes do not exist (404), so neither does their auth exemption.
 */
export const docsRoutes: FastifyPluginAsync = async (app) => {
  // public: docs must be readable without a session, the same deliberate
  // opt-out as /health (ADR-0007 allowlist). @fastify/swagger-ui offers no
  // per-route config passthrough, so this hook — encapsulated to this plugin
  // scope — marks exactly the routes registered below; the guard-the-guard
  // allowlist test pins the resulting set.
  app.addHook('onRoute', (route) => {
    route.config = { ...route.config, public: true };
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
};

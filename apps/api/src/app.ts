import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { type Env } from './env.ts';
import { createInMemoryExampleRepository } from './modules/example/example.repository.ts';
import { exampleRoutes } from './modules/example/example.routes.ts';
import { createExampleService } from './modules/example/example.service.ts';
import { healthRoutes } from './routes/health.ts';

/**
 * Builds the Fastify instance from an already-validated Env (main.ts owns the
 * fail-fast parse). Kept separate from listening so tests can `inject()`
 * against the real app.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    // pino structured JSON at the zod-validated level; every request gets a
    // UUID id (or the caller's x-request-id) carried through all its log lines.
    logger: { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  const production = env.NODE_ENV === 'production';

  // Centralized error shape: { error: { code, message } } (ARCHITECTURE §API
  // conventions). The full error — message and stack — goes to the log only,
  // never the response body. In production, 5xx additionally hide the internal
  // message behind a generic one; 4xx are intentional and pass through.
  app.setErrorHandler((error, request, reply) => {
    // Fastify types thrown values as unknown — narrow before touching fields.
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    request.log.error({ err }, 'request failed');
    const fallbackCode = statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR';
    const code = 'code' in err && typeof err.code === 'string' ? err.code : fallbackCode;
    const hideInternals = production && statusCode >= 500;
    return reply.status(statusCode).send({
      error: {
        code: hideInternals ? 'INTERNAL_SERVER_ERROR' : code,
        message: hideInternals ? 'Internal Server Error' : err.message,
      },
    });
  });

  // Unknown routes use the same error shape as everything else.
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    }),
  );

  // Composition root, wired routes → services → repositories. When
  // packages/db lands (M0-06), its Drizzle repository replaces the in-memory
  // stub on this line and nothing else changes.
  const exampleService = createExampleService(createInMemoryExampleRepository());

  await app.register(healthRoutes);
  await app.register(exampleRoutes(exampleService));

  return app;
}

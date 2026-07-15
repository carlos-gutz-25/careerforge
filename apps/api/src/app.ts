import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import {
  createDb,
  createProfileRepository,
  createSessionsRepository,
  createUsersRepository,
  type Db,
} from '@careerforge/db';

import { type Env } from './env.ts';
import { createAuthService } from './modules/auth/auth.service.ts';
import { registerAuthGuard } from './modules/auth/auth.hooks.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { type Passwords, passwords as realPasswords } from './modules/auth/passwords.ts';
import {
  createFixedWindowRateLimiter,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  type RateLimiter,
} from './modules/auth/rate-limit.ts';
import { createInMemoryExampleRepository } from './modules/example/example.repository.ts';
import { exampleRoutes } from './modules/example/example.routes.ts';
import { createExampleService } from './modules/example/example.service.ts';
import { createProfileImportService } from './modules/profile/profile.service.ts';
import { profileRoutes } from './modules/profile/profile.routes.ts';
import { docsRoutes } from './routes/docs.ts';
import { healthRoutes } from './routes/health.ts';
import packageJson from '../package.json' with { type: 'json' };

/** The real, gitignored profile directory at the repo root. */
const REAL_PROFILE_DIR = fileURLToPath(new URL('../../../docs/profile', import.meta.url));

/** Under NODE_ENV=test the default is a nonexistent sentinel, so a test that
 *  forgets to inject `profileDir` fails loudly instead of silently reading
 *  real career data (RISKS P-01: pnpm test must never touch docs/profile/). */
const TEST_PROFILE_DIR_SENTINEL = '/nonexistent-profile-dir--tests-must-inject-profileDir';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle handle for boot-time work (main.ts bootstrap); request-path
     *  data access stays behind repositories wired here. */
    db: Db;
  }
}

/** Test seams; production uses the defaults. An injected dbHandle stays
 *  owned by its caller — buildApp only closes the pool it created itself. */
export interface AppDeps {
  dbHandle?: ReturnType<typeof createDb>;
  passwords?: Passwords;
  loginRateLimiter?: RateLimiter;
  now?: () => Date;
  /** Directory the profile importer reads (resume.md/skills.md/projects.md). */
  profileDir?: string;
  /** Fires for every registered route — lets tests assert the public-route
   *  allowlist is exactly what's expected (guard-the-guard). */
  onRoute?: (route: { method: string | string[]; url: string; public: boolean }) => void;
}

/**
 * Builds the Fastify instance from an already-validated Env (main.ts owns the
 * fail-fast parse). Kept separate from listening so tests can `inject()`
 * against the real app.
 */
export async function buildApp(env: Env, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // pino structured JSON at the zod-validated level; every request gets a
    // UUID id (or the caller's x-request-id) carried through all its log lines.
    logger: { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  const production = env.NODE_ENV === 'production';

  // Route zod schemas are the single source of truth (ADR-0002): the zod
  // compilers enforce them at runtime, and @fastify/swagger derives the
  // OpenAPI spec from the same declarations.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Centralized error shape: { error: { code, message } } (ARCHITECTURE §API
  // conventions). The full error — message and stack — goes to the log only,
  // never the response body. In production, 5xx additionally hide the internal
  // message behind a generic one; 4xx are intentional and pass through.
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      // Value-free by construction: paths + zod issue codes ONLY, never
      // issue.message — enum/literal mismatch messages echo the received
      // value, and request bodies (login credentials today, pasted posting
      // text in M1) must never round-trip into a response.
      const context = error.validationContext ?? 'request';
      const details = error.validation
        .map((issue) => `${context}${issue.instancePath}: ${issue.keyword}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: details } });
    }
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

  // Composition root, wired routes → services → repositories (Drizzle-backed
  // repositories from packages/db; the example slice stays in-memory on
  // purpose as the layering reference — no table behind it).
  const ownsDbHandle = deps.dbHandle === undefined;
  const dbHandle = deps.dbHandle ?? createDb(env.DATABASE_URL);
  if (ownsDbHandle) {
    app.addHook('onClose', () => dbHandle.pool.end());
  }
  app.decorate('db', dbHandle.db);

  const passwords = deps.passwords ?? realPasswords;
  const authService = await createAuthService({
    users: createUsersRepository(dbHandle.db),
    sessions: createSessionsRepository(dbHandle.db),
    passwords,
    now: deps.now,
  });
  const loginRateLimiter =
    deps.loginRateLimiter ??
    createFixedWindowRateLimiter({
      maxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    });
  const exampleService = createExampleService(createInMemoryExampleRepository());
  const profileImportService = createProfileImportService({
    profileDir:
      deps.profileDir ?? (env.NODE_ENV === 'test' ? TEST_PROFILE_DIR_SENTINEL : REAL_PROFILE_DIR),
    profile: createProfileRepository(dbHandle.db),
  });

  const { onRoute } = deps;
  if (onRoute) {
    app.addHook('onRoute', (route) =>
      onRoute({
        method: route.method,
        url: route.url,
        // Read live, not snapshotted: scoped onRoute hooks that run AFTER
        // this root-level collector can still finalize config — the /docs
        // plugin marks its routes public that way. A snapshot here would
        // hide exactly the exemptions the allowlist test exists to see.
        get public() {
          return route.config?.public === true;
        },
      }),
    );
  }

  // Order is load-bearing: cookie parsing is an onRequest hook, so its
  // register must be awaited before the guard hook is added, and the guard
  // must exist before any guarded route registers. @fastify/swagger must be
  // registered before the routes whose schemas it collects; it adds no routes
  // itself (only the in-memory app.swagger() builder), so it is safe in every
  // env — the /docs UI below is the only exposed surface.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'CareerForge API', version: packageJson.version },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifyCookie);
  registerAuthGuard(app, { auth: authService, webAppOrigin: env.WEB_APP_ORIGIN });

  await app.register(healthRoutes);
  await app.register(
    authRoutes({ auth: authService, loginRateLimiter, secureCookies: production }),
  );
  await app.register(exampleRoutes(exampleService));
  await app.register(profileRoutes(profileImportService));
  // Dev-only docs UI (M0-09): absent in production means the routes 404 and
  // their auth exemption never exists there.
  if (!production) await app.register(docsRoutes);

  return app;
}

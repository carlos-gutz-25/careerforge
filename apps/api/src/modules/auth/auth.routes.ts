import { type FastifyPluginCallback, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { type AuthService, SESSION_COOKIE_NAME, SESSION_TTL_MS } from './auth.service.ts';
import { UnauthorizedError } from './auth.hooks.ts';
import { type RateLimiter } from './rate-limit.ts';

// Boundary validation (CLAUDE.md): zod-parsed by hand until the
// fastify-type-provider-zod + OpenAPI wiring lands with M0-09.
const loginBodySchema = z.object({ email: z.string(), password: z.string() });

export class InvalidLoginBodyError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  constructor() {
    // Deliberately value-free: attempted credentials never echo into
    // responses or logs.
    super('body must be { email: string, password: string }');
  }
}

export function authRoutes(options: {
  auth: AuthService;
  loginRateLimiter: RateLimiter;
  /** Secure cookie attribute — true in production (HTTPS-only by policy). */
  secureCookies: boolean;
}): FastifyPluginCallback {
  const { auth, loginRateLimiter, secureCookies } = options;

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: secureCookies,
  } as const;

  // Runs before body parsing; counts every attempt against the caller's IP
  // (the API binds 127.0.0.1 with no trustProxy, so request.ip is not
  // spoofable via forwarding headers).
  function loginRateLimitHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
    const decision = loginRateLimiter.check(request.ip);
    if (!decision.allowed) {
      void reply
        .header('retry-after', decision.retryAfterSeconds)
        .status(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'too many login attempts' } });
      return;
    }
    done();
  }

  return (app, _opts, done) => {
    app.post(
      '/auth/login',
      { config: { public: true }, onRequest: loginRateLimitHook },
      async (request, reply) => {
        const parsed = loginBodySchema.safeParse(request.body);
        if (!parsed.success) throw new InvalidLoginBodyError();

        const { user, token, expiresAt } = await auth.login({
          ...parsed.data,
          // Rotation: a session presented on login is replaced, not kept.
          presentedToken: request.cookies[SESSION_COOKIE_NAME],
        });
        request.log.info({ userId: user.id }, 'login succeeded');
        void reply.setCookie(SESSION_COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: Math.floor(SESSION_TTL_MS / 1000),
        });
        return { user: { id: user.id, email: user.email }, expiresAt: expiresAt.toISOString() };
      },
    );

    app.post('/auth/logout', async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE_NAME];
      if (token) await auth.logout(token);
      void reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
      return reply.status(204).send();
    });

    app.get('/auth/me', (request) => {
      // The guard populated this; the check keeps the type honest without a
      // non-null assertion.
      if (!request.user) throw new UnauthorizedError();
      return { id: request.user.id, email: request.user.email };
    });

    done();
  };
}

import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { errorEnvelopeSchema } from '../../schemas.ts';
import { type AuthService, SESSION_COOKIE_NAME, SESSION_TTL_MS } from './auth.service.ts';
import { UnauthorizedError } from './auth.hooks.ts';
import { type RateLimiter } from './rate-limit.ts';

// Boundary validation (CLAUDE.md): declared on the route and enforced by the
// zod validator compiler before the handler runs (M0-09). Invalid bodies
// surface as the centralized VALIDATION_ERROR envelope, which is value-free
// by construction (app.ts) — attempted credentials never echo into responses
// or logs.
const loginBodySchema = z.object({ email: z.string(), password: z.string() });

const sessionUserSchema = z.object({ id: z.string(), email: z.string() });

export function authRoutes(options: {
  auth: AuthService;
  loginRateLimiter: RateLimiter;
  /** Secure cookie attribute — true in production (HTTPS-only by policy). */
  secureCookies: boolean;
}): FastifyPluginCallbackZod {
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
      {
        config: { public: true },
        onRequest: loginRateLimitHook,
        schema: {
          body: loginBodySchema,
          response: {
            200: z.object({ user: sessionUserSchema, expiresAt: z.string() }),
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            429: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { user, token, expiresAt } = await auth.login({
          email: request.body.email,
          password: request.body.password,
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

    app.post(
      '/auth/logout',
      {
        schema: {
          response: {
            204: z.null(),
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const token = request.cookies[SESSION_COOKIE_NAME];
        if (token) await auth.logout(token);
        void reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
        // The declared 204 schema is z.null(), so send() needs the explicit
        // null; fastify still emits an empty body for 204.
        return reply.status(204).send(null);
      },
    );

    app.get(
      '/auth/me',
      {
        schema: {
          response: { 200: sessionUserSchema, 401: errorEnvelopeSchema },
        },
      },
      (request) => {
        // The guard populated this; the check keeps the type honest without a
        // non-null assertion.
        if (!request.user) throw new UnauthorizedError();
        return { id: request.user.id, email: request.user.email };
      },
    );

    done();
  };
}

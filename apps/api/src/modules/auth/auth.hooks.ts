import { type FastifyInstance } from 'fastify';
import { type Session, type User } from '@careerforge/db';

import { type AuthService, SESSION_COOKIE_NAME } from './auth.service.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Opt-OUT protection: routes are 401-guarded unless they declare this. */
    public?: boolean;
  }
  interface FastifyRequest {
    user: User | undefined;
    session: Session | undefined;
  }
}

export class UnauthorizedError extends Error {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('authentication required');
  }
}

export class ForbiddenOriginError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN_ORIGIN';
  constructor(message: string) {
    super(message);
  }
}

// Distinct 403 messages for diagnosability - same class, same code (M13-06).
// Value-free: neither echoes the request's Origin.
export const ORIGIN_REQUIRED_MESSAGE = 'origin header required';
export const ORIGIN_MISMATCH_MESSAGE = 'cross-origin request rejected';

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Root-level guard (ADR-0007). Every matched route requires a valid session
 * unless it declares `config: { public: true }` - adding an unprotected route
 * silently is impossible; exposure is an explicit, diff-visible opt-out.
 *
 * CSRF posture (M13-06, fail-closed - ADR-0007 amended): SameSite=Lax + this
 * origin check on mutating methods (which also covers the public login route -
 * login CSRF is real). A mutating request MUST carry an Origin the browser
 * sends same-origin; BOTH an absent Origin and a mismatched one are rejected
 * 403. The old absent-passes carve-out is closed: non-browser callers must now
 * send Origin explicitly. This assumes GET routes never mutate state (invariant
 * recorded in ADR-0007).
 *
 * MUST be added after @fastify/cookie's register is awaited - cookie parsing
 * is itself an onRequest hook and hook order is registration order.
 */
export function registerAuthGuard(
  app: FastifyInstance,
  options: { auth: AuthService; webAppOrigin: string },
): void {
  const { auth } = options;
  const webAppOrigin = new URL(options.webAppOrigin).origin;

  app.decorateRequest('user');
  app.decorateRequest('session');

  app.addHook('onRequest', async (request) => {
    // Unmatched routes keep their 404 contract (the repo is public - route
    // existence is not a secret, and there is nothing to protect on a 404).
    if (request.is404) return;

    if (MUTATING_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      // Fail-closed: absent is rejected too (was the non-browser carve-out).
      // Runs before the public bypass so login keeps CSRF protection.
      if (origin === undefined) throw new ForbiddenOriginError(ORIGIN_REQUIRED_MESSAGE);
      if (origin !== webAppOrigin) throw new ForbiddenOriginError(ORIGIN_MISMATCH_MESSAGE);
    }

    if (request.routeOptions.config?.public === true) return;

    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedError();
    const authenticated = await auth.validateSession(token);
    if (!authenticated) throw new UnauthorizedError();
    request.user = authenticated.user;
    request.session = authenticated.session;
  });
}

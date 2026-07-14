// Integration suite for M0-07 session auth, against dockerized Postgres
// (careerforge_test via the shared packages/db harness). Every user and
// credential here is fictional and created in-test — never the env user.
import { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionsRepository, createUsersRepository } from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { type AppDeps, buildApp } from '../../app.ts';
import { SESSION_COOKIE_NAME } from './auth.service.ts';
import { passwords } from './passwords.ts';
import { createFixedWindowRateLimiter } from './rate-limit.ts';
import { hashSessionToken } from './tokens.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  TEST_USER,
} from '../../test/auth-test-helpers.ts';

const handle = createTestDb();
const env = buildTestEnv();
const sessionsRepo = createSessionsRepository(handle.db);

let app: FastifyInstance | undefined;

beforeEach(async () => {
  await truncateAllTables(handle);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await handle.pool.end();
});

async function build(deps: AppDeps = {}, testEnv = env): Promise<FastifyInstance> {
  app = await buildApp(testEnv, { dbHandle: handle, ...deps });
  return app;
}

function login(
  instance: FastifyInstance,
  body: unknown = { email: TEST_USER.email, password: TEST_USER.password },
  extra: Partial<InjectOptions> = {},
) {
  return instance.inject({ method: 'POST', url: '/auth/login', body: body as object, ...extra });
}

function sessionCookieOf(response: { cookies: { name: string; value: string }[] }) {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (!cookie) throw new Error('no session cookie in response');
  return cookie;
}

function asCookieHeader(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

describe('POST /auth/login', () => {
  it('sets a session cookie backed by a sessions row', async () => {
    const instance = await build();
    const user = await createTestUser(handle);

    const response = await login(instance);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: user.id, email: TEST_USER.email },
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });

    const token = sessionCookieOf(response).value;
    const row = await sessionsRepo.findByTokenHash(hashSessionToken(token));
    expect(row?.userId).toBe(user.id);
    // 7-day absolute expiry (generous tolerance; wall clock, not fake).
    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs((row?.expiresAt.getTime() ?? 0) - expectedExpiry)).toBeLessThan(60_000);
  });

  it('sets the ratified cookie attributes (no Secure outside production)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const response = await login(instance);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).not.toContain('Secure');
  });

  it('adds Secure in production mode', async () => {
    const instance = await build({}, buildTestEnv({ NODE_ENV: 'production' }));
    await createTestUser(handle);

    const response = await login(instance);
    expect(String(response.headers['set-cookie'])).toContain('Secure');
  });

  it('returns identical responses for wrong password and unknown email (no enumeration)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const wrongPassword = await login(instance, {
      email: TEST_USER.email,
      password: 'wrong-password-entirely',
    });
    const unknownEmail = await login(instance, {
      email: 'nobody.here@example.com',
      password: 'wrong-password-entirely',
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'invalid email or password' },
    });
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(unknownEmail.headers['content-type']).toBe(wrongPassword.headers['content-type']);
  });

  it('pays an argon2 verification on the unknown-email path (comparable timing)', async () => {
    const verifySpy = vi.fn((storedHash: string, password: string) =>
      passwords.verifyPassword(storedHash, password),
    );
    const instance = await build({
      passwords: {
        hashPassword: (password) => passwords.hashPassword(password),
        verifyPassword: verifySpy,
      },
    });

    await login(instance, { email: 'nobody.here@example.com', password: 'irrelevant' });
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed body without echoing values', async () => {
    const instance = await build();
    const response = await login(instance, { email: 42 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'body must be { email: string, password: string }',
      },
    });
  });

  it('fails closed (401, not 500) for a user with a malformed stored hash — the seed example user', async () => {
    const instance = await build();
    await createUsersRepository(handle.db).create({
      email: 'alex.rivera.example@example.com',
      passwordHash: 'unverifiable-by-design-example-user-cannot-log-in',
    });

    const response = await login(instance, {
      email: 'alex.rivera.example@example.com',
      password: 'anything-at-all',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('session rotation on login', () => {
  it('replaces a presented session: new cookie, old row deleted, old cookie dead', async () => {
    const instance = await build();
    await createTestUser(handle);

    const first = await login(instance);
    const tokenA = sessionCookieOf(first).value;

    const second = await login(instance, undefined, { headers: asCookieHeader(tokenA) });
    const tokenB = sessionCookieOf(second).value;
    expect(tokenB).not.toBe(tokenA);
    expect(await sessionsRepo.findByTokenHash(hashSessionToken(tokenA))).toBeUndefined();

    const withA = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader(tokenA),
    });
    expect(withA.statusCode).toBe(401);
    const withB = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader(tokenB),
    });
    expect(withB.statusCode).toBe(200);
  });

  it('sweeps expired sessions on successful login', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token: expiredToken } = await createSessionRow(
      handle,
      user.id,
      new Date(Date.now() - 1000),
    );

    await login(instance);
    expect(await sessionsRepo.findByTokenHash(hashSessionToken(expiredToken))).toBeUndefined();
  });
});

describe('session expiry', () => {
  it('401s an expired session and lazily deletes its row', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id, new Date(Date.now() - 1000));

    const response = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader(token),
    });
    expect(response.statusCode).toBe(401);
    expect(await sessionsRepo.findByTokenHash(hashSessionToken(token))).toBeUndefined();
  });
});

describe('GET /auth/me', () => {
  it('returns only id and email — never the password hash', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);

    const response = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: user.id, email: user.email });
  });

  it('401s a garbage cookie value', async () => {
    const instance = await build();
    const response = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader('not-a-real-token'),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);

    const response = await instance.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: asCookieHeader(token),
    });
    expect(response.statusCode).toBe(204);
    expect(sessionCookieOf(response).value).toBe('');
    expect(await sessionsRepo.findByTokenHash(hashSessionToken(token))).toBeUndefined();

    const me = await instance.inject({
      method: 'GET',
      url: '/auth/me',
      headers: asCookieHeader(token),
    });
    expect(me.statusCode).toBe(401);
  });

  it('is itself guarded: no session, no logout', async () => {
    const instance = await build();
    const response = await instance.inject({ method: 'POST', url: '/auth/logout' });
    expect(response.statusCode).toBe(401);
  });
});

describe('401 by default (opt-OUT protection)', () => {
  it('the public allowlist is exactly /health and POST /auth/login', async () => {
    const routes: { method: string | string[]; url: string; public: boolean }[] = [];
    const instance = await build({ onRoute: (route) => routes.push(route) });
    await instance.ready();

    const publicRoutes = routes
      .filter((route) => route.public && route.method !== 'HEAD')
      .map((route) => `${String(route.method)} ${route.url}`)
      .sort();
    expect(publicRoutes).toEqual(['GET /health', 'POST /auth/login']);
  });

  it('a route added with no config at all is protected', async () => {
    const instance = await build();
    instance.get('/added-without-any-config', () => ({ leaked: true }));

    const response = await instance.inject({ method: 'GET', url: '/added-without-any-config' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'authentication required' },
    });
  });

  it('guards the example slice and serves it to a session', async () => {
    const instance = await build();
    const user = await createTestUser(handle);
    const { token } = await createSessionRow(handle, user.id);

    const anonymous = await instance.inject({ method: 'GET', url: '/example/items' });
    expect(anonymous.statusCode).toBe(401);

    const authenticated = await instance.inject({
      method: 'GET',
      url: '/example/items',
      headers: asCookieHeader(token),
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual([
      { id: 'one', name: 'First example item' },
      { id: 'two', name: 'Second example item' },
    ]);
  });
});

describe('CSRF origin check on mutations', () => {
  it('403s a mutation from a foreign origin — including login', async () => {
    const instance = await build();
    await createTestUser(handle);

    const response = await login(instance, undefined, {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('accepts mutations from WEB_APP_ORIGIN and from non-browser clients (no Origin)', async () => {
    const instance = await build();
    await createTestUser(handle);

    const fromWebApp = await login(instance, undefined, {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(fromWebApp.statusCode).toBe(200);

    const noOrigin = await login(instance);
    expect(noOrigin.statusCode).toBe(200);
  });

  it('does not gate non-mutating requests on Origin', async () => {
    const instance = await build();
    const response = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('login rate limiting', () => {
  it('429s after the limit and recovers when the window elapses (fake clock)', async () => {
    let at = 1_000_000;
    const limiter = createFixedWindowRateLimiter({
      maxAttempts: 10,
      windowMs: 15 * 60_000,
      now: () => at,
    });
    const instance = await build({ loginRateLimiter: limiter });
    await createTestUser(handle);
    const badBody = { email: TEST_USER.email, password: 'wrong-password-entirely' };

    for (let i = 0; i < 10; i++) {
      const response = await login(instance, badBody);
      expect(response.statusCode).toBe(401); // limiter passed; credentials failed
    }
    const blocked = await login(instance, badBody);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'too many login attempts' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    at += 15 * 60_000;
    const afterWindow = await login(instance, badBody);
    expect(afterWindow.statusCode).toBe(401);
  });

  it('does not rate-limit other routes', async () => {
    const at = 1_000_000;
    const limiter = createFixedWindowRateLimiter({
      maxAttempts: 1,
      windowMs: 60_000,
      now: () => at,
    });
    const instance = await build({ loginRateLimiter: limiter });

    for (let i = 0; i < 3; i++) {
      const response = await instance.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    }
  });
});

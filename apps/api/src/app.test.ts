// DB-free app contract tests (fake DATABASE_URL; pg.Pool is lazy and nothing
// here queries). Authenticated behavior — sessions, guarded routes served to
// a logged-in user — lives in modules/auth/auth.routes.test.ts against the
// real test database.
import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };
import { buildApp } from './app.ts';
import { parseEnv } from './env.ts';
import { NotFoundError } from './modules/example/example.service.ts';

// Fictional values throughout — tests never see real credentials.
const TEST_ENV = {
  LOG_LEVEL: 'fatal', // keep expected-error noise out of test output
  DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge_test',
  AUTH_BOOTSTRAP_EMAIL: 'casey.test@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-test-password',
};

const SECRET_DETAIL = 'db connection refused: password=hunter2 at pg.internal:5432';

async function buildWithBoom(nodeEnv: 'development' | 'production') {
  const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: nodeEnv }));
  // public so the 401 guard doesn't intercept what this route exists to test.
  app.get('/boom', { config: { public: true } }, () => {
    throw new Error(SECRET_DETAIL);
  });
  return app;
}

describe('GET /health', () => {
  it('returns status and the package.json version without a session', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: packageJson.version });
  });
});

describe('default-deny guard', () => {
  it('401s the example slice without a session (guarded like every route)', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/example/items' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'authentication required' },
    });
  });
});

describe('centralized error handler', () => {
  it('unknown routes use the same { error: { code, message } } shape — 404, not 401', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /definitely-not-a-route not found' },
    });
  });

  it('maps a domain error to the standard shape via its statusCode/code', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    app.get('/domain-error', { config: { public: true } }, () => {
      throw new NotFoundError("example item 'nope' not found");
    });
    const response = await app.inject({ method: 'GET', url: '/domain-error' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: "example item 'nope' not found" },
    });
  });

  it('in dev, 500 bodies carry the message but never a stack trace', async () => {
    const app = await buildWithBoom('development');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: SECRET_DETAIL },
    });
    expect(response.payload).not.toMatch(/\n\s+at /); // no stack frames
  });

  it('in production, 500 bodies are fully sanitized', async () => {
    const app = await buildWithBoom('production');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(response.payload).not.toContain('hunter2');
    expect(response.payload).not.toMatch(/\n\s+at /);
  });

  it('in production, intentional 4xx errors still pass their message through', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'production' }));
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: 42 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'body must be { email: string, password: string }',
      },
    });
  });
});

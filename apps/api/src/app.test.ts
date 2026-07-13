import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };
import { buildApp } from './app.ts';
import { parseEnv } from './env.ts';

const TEST_ENV = {
  LOG_LEVEL: 'fatal', // keep expected-error noise out of test output
  DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge_test',
};

const SECRET_DETAIL = 'db connection refused: password=hunter2 at pg.internal:5432';

async function buildWithBoom(nodeEnv: 'development' | 'production') {
  const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: nodeEnv }));
  app.get('/boom', () => {
    throw new Error(SECRET_DETAIL);
  });
  return app;
}

describe('GET /health', () => {
  it('returns status and the package.json version', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: packageJson.version });
  });
});

describe('example layering slice', () => {
  it('lists items through route → service → repository', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/example/items' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: 'one', name: 'First example item' },
      { id: 'two', name: 'Second example item' },
    ]);
  });

  it('returns a single item by id', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/example/items/one' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'one', name: 'First example item' });
  });

  it('maps a domain NotFoundError to the standard error shape', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/example/items/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: "example item 'nope' not found" },
    });
  });
});

describe('centralized error handler', () => {
  it('unknown routes use the same { error: { code, message } } shape', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /definitely-not-a-route not found' },
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
    const response = await app.inject({ method: 'GET', url: '/example/items/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: "example item 'nope' not found" },
    });
  });
});

// M10-02: same-origin static serving of the generated SPA payload. Exercises
// the WEB_DIST_DIR wiring in app.ts (D1, amended r2-A1): @fastify/static with a
// wildcard route opted public via config.public (onRoute stamp -- the global
// guard hook applies regardless of registration order), an Accept-aware SPA
// navigation short-circuit for browser deep-links, immutable caching for /_nuxt/
// assets, and boot-fail on an unreadable dist. Every dist dir here is a
// throwaway fixture built in-test (os.tmpdir), never a committed payload.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp } from './app.ts';
import { buildTestEnv } from './test/auth-test-helpers.ts';

const handle = createTestDb();

const SHELL_MARKER = 'SPA-SHELL-MARKER-M10-02';
const ASSET = '_nuxt/entry.abcd1234.js';

// A minimal but structurally faithful `nuxt generate` payload: an entry shell
// (index.html) plus a content-hashed asset under _nuxt/.
function makeDistDir(withEntry = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-webdist-'));
  mkdirSync(join(dir, '_nuxt'), { recursive: true });
  writeFileSync(join(dir, ASSET), 'console.log("fixture asset");');
  if (withEntry) {
    const html = `<!DOCTYPE html><html><head><title>${SHELL_MARKER}</title></head><body><div id="app"></div></body></html>`;
    writeFileSync(join(dir, 'index.html'), html);
    writeFileSync(join(dir, '200.html'), html);
  }
  return dir;
}

const distDir = makeDistDir();
const tempDirs = [distDir];

let app: FastifyInstance | undefined;

async function build(webDistDir: string | undefined): Promise<FastifyInstance> {
  const overrides: Record<string, string> =
    webDistDir === undefined ? {} : { WEB_DIST_DIR: webDistDir };
  app = await buildApp(buildTestEnv(overrides), { dbHandle: handle });
  return app;
}

beforeAll(async () => {
  await truncateAllTables(handle);
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  await handle.pool.end();
});

describe('static serving is OFF when WEB_DIST_DIR is unset (dev/test/CI)', () => {
  it('an unknown GET asking for HTML still gets the JSON 404 envelope (no SPA fallback)', async () => {
    const instance = await build(undefined);
    const response = await instance.inject({
      method: 'GET',
      url: '/no-such-client-route',
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /no-such-client-route not found',
      },
    });
  });
});

describe('static serving with WEB_DIST_DIR set (M10-02 same-origin payload)', () => {
  it('serves a content-hashed /_nuxt/ asset unauthenticated with an immutable cache header', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({ method: 'GET', url: `/${ASSET}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('fixture asset');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('hard-refreshes a client-side route (GET + Accept html) into the entry shell, 200, no-cache', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'GET',
      url: '/some-nonexistent-client-page',
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain(SHELL_MARKER);
  });

  it('keeps the JSON 404 contract byte-for-byte for API clients (Accept json)', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'GET',
      url: '/no-such-api-route',
      headers: { accept: 'application/json' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /no-such-api-route not found' },
    });
  });

  it('lets an explicit API route win over the static wildcard (/health stays JSON)', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('still protects guarded API routes (the static surface is public, the API is not)', async () => {
    const instance = await build(distDir);
    // A guarded probe (no config.public) added alongside the static wildcard:
    // the explicit route wins over the wildcard and the root guard still 401s an
    // API client (no text/html Accept, so the SPA short-circuit does not fire).
    instance.get('/guarded-probe', () => ({ leaked: true }));
    const response = await instance.inject({ method: 'GET', url: '/guarded-probe' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'authentication required' },
    });
  });
});

// r2-A1 amendment: a browser navigation (GET/HEAD + Accept prefers text/html,
// dot-less path, not a named always-API route) resolves to the SPA shell BEFORE
// the guard -- even on paths that collide with a guarded API route -- while API
// clients (json / */* / absent Accept) fall through byte-for-byte.
describe('SPA navigation short-circuit is Accept-aware (r2-A1, colliding API paths)', () => {
  // /postings/:id is a real guarded API route; /postings/<id> is also a client
  // page. This is the collision the short-circuit exists to resolve.
  const COLLIDING = '/postings/deadbeef-collides-with-getpostingid';

  it('resolves a browser navigation to a colliding API path into the shell (GET + text/html)', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'GET',
      url: COLLIDING,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain(SHELL_MARKER);
  });

  it('leaves the API contract byte-unchanged for json / */* / absent Accept (still hits the guarded route)', async () => {
    const instance = await build(distDir);
    for (const accept of ['application/json', '*/*']) {
      const response = await instance.inject({
        method: 'GET',
        url: COLLIDING,
        headers: { accept },
      });
      expect(response.statusCode, `Accept: ${accept}`).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'authentication required' },
      });
    }
    // Absent Accept header entirely.
    const noAccept = await instance.inject({ method: 'GET', url: COLLIDING });
    expect(noAccept.statusCode).toBe(401);
  });

  it('serves the shell for a HEAD navigation (headers only, 200)', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'HEAD',
      url: '/skills',
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('a dotted-segment asset path is served as the asset, not the shell (even with Accept html)', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'GET',
      url: `/${ASSET}`,
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('fixture asset');
    expect(response.body).not.toContain(SHELL_MARKER);
  });

  it('a named always-API path (/health) stays JSON even under a text/html navigation', async () => {
    const instance = await build(distDir);
    const response = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('the public static surface is pinned (D10-i route-pin)', () => {
  it('registers the static wildcard as a PUBLIC route (config.public) when WEB_DIST_DIR is set', async () => {
    const routes: { method: string | string[]; url: string; public: boolean }[] = [];
    app = await buildApp(buildTestEnv({ WEB_DIST_DIR: distDir }), {
      dbHandle: handle,
      onRoute: (route) => routes.push(route),
    });
    await app.ready();
    const publicRoutes = routes
      .filter((route) => route.public)
      .map((route) => `${String(route.method)} ${route.url}`);
    // @fastify/static registers the wildcard for HEAD+GET; the onRoute stamp
    // opts it out of the guard. Drift in either direction fails this pin.
    expect(publicRoutes).toContain('HEAD,GET /*');
  });

  it('does NOT register a public wildcard when WEB_DIST_DIR is unset', async () => {
    const routes: { method: string | string[]; url: string; public: boolean }[] = [];
    app = await buildApp(buildTestEnv(), {
      dbHandle: handle,
      onRoute: (route) => routes.push(route),
    });
    await app.ready();
    const wildcards = routes
      .map((route) => `${String(route.method)} ${route.url}`)
      .filter((r) => r.endsWith(' /*'));
    expect(wildcards).toEqual([]);
  });
});

describe('boot fails fast on a misconfigured dist dir (D2)', () => {
  it('rejects at build time when WEB_DIST_DIR has no readable entry shell', async () => {
    const emptyDir = makeDistDir(false);
    tempDirs.push(emptyDir);
    await expect(build(emptyDir)).rejects.toThrow();
    app = undefined;
  });
});

// DB-free app contract tests (fake DATABASE_URL; pg.Pool is lazy and nothing
// here queries). Authenticated behavior — sessions, guarded routes served to
// a logged-in user — lives in modules/auth/auth.routes.test.ts against the
// real test database.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import packageJson from '../package.json' with { type: 'json' };
import { buildApp } from './app.ts';
import { parseEnv } from './env.ts';

// Fictional values throughout — tests never see real credentials.
const TEST_ENV = {
  LOG_LEVEL: 'fatal', // keep expected-error noise out of test output
  DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge_test',
  AUTH_BOOTSTRAP_EMAIL: 'casey.test@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-test-password',
};

const SECRET_DETAIL = 'db connection refused: password=hunter2 at pg.internal:5432';

// The Origin a same-origin browser sends - matches the guard's webAppOrigin
// (M13-06 fail-closed CSRF). Sourced from the env default so these DB-free
// tests need no cross-module import.
const ORIGIN_HEADER = {
  origin: new URL(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }).WEB_APP_ORIGIN).origin,
};

// A minimal domain error mirroring the statusCode/code convention the
// centralized error handler translates. It formerly rode in on the example
// slice's NotFoundError (retired in M13-08); kept local so the handler
// contract stays covered without a runtime module behind it.
class ProbeNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

async function buildWithBoom(nodeEnv: 'development' | 'production') {
  const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: nodeEnv }));
  // public so the 401 guard doesn't intercept what this route exists to test.
  app.get('/boom', { config: { public: true } }, () => {
    throw new Error(SECRET_DETAIL);
  });
  return app;
}

describe('GET /health', () => {
  it('returns status, version, and demo:false without a session (non-demo)', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: packageJson.version, demo: false });
  });

  it('reports demo:true when DEMO_MODE is on (M10-03 D8 - the demo-vs-real signal)', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test', DEMO_MODE: '1' }));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: packageJson.version, demo: true });
  });
});

describe('default-deny guard', () => {
  it('401s a guarded route without a session (protection is opt-OUT, not opt-in)', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    // A route with no config is guarded by the root onRequest hook, which runs
    // before the handler, so this 401s without ever touching the DB.
    app.get('/guarded-probe', () => ({ leaked: true }));
    const response = await app.inject({ method: 'GET', url: '/guarded-probe' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'authentication required' },
    });
  });

  it('the retired example slice is gone: GET /example/items 404s (M13-08)', async () => {
    // The example module was deleted in M13-08; the path is now unknown and
    // falls through the guard to the 404 contract (never a 401 that would imply
    // a hidden guarded route still exists).
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/example/items' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /example/items not found' },
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
      throw new ProbeNotFoundError("probe item 'nope' not found");
    });
    const response = await app.inject({ method: 'GET', url: '/domain-error' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: "probe item 'nope' not found" },
    });
  });

  // M15-04: this test formerly asserted the OPPOSITE -- that dev 500s pass the
  // internal message through. That passthrough was the browser leg of
  // FINDING-A: dev-only, but one env var away from being live, and a standing
  // violation of "internals must not reach the client". The rewrite is
  // authorized in the approved plan (D2b); the trade is that a developer now
  // reads the detail in the log instead of the browser.
  //
  // /boom throws a BARE Error -- no statusCode, no code -- so it is an
  // internal by the handler's test and is suppressed. The companion case, a
  // declared domain 5xx passing through, is asserted below.
  it('in dev, 500 bodies are generic too -- internals never reach the client', async () => {
    const app = await buildWithBoom('development');
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(response.payload).not.toContain('hunter2');
    expect(response.payload).not.toContain(SECRET_DETAIL);
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

  // M15-04: the other half of the invariant. An INTENTIONAL 5xx -- one whose
  // author declared both statusCode and code, with a message built from
  // constants -- is published API contract, not an internal. Flattening it
  // would hide nothing and would cost a caller the ability to tell "the LLM
  // is not configured" (503) from "something broke" (500).
  it('declared domain 5xx pass their code and message through, even in production', async () => {
    class LlmNotConfiguredProbeError extends Error {
      readonly statusCode = 503;
      readonly code = 'LLM_NOT_CONFIGURED';
      constructor() {
        super('no LLM provider configured - set ANTHROPIC_API_KEY');
      }
    }
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'production' }));
    app.get('/declared-503', { config: { public: true } }, () => {
      throw new LlmNotConfiguredProbeError();
    });

    const response = await app.inject({ method: 'GET', url: '/declared-503' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'LLM_NOT_CONFIGURED',
        message: 'no LLM provider configured - set ANTHROPIC_API_KEY',
      },
    });
  });

  // The second gate: unsafe-by-construction beats declared-contract. A class
  // that embeds query values in its message stays suppressed even when it
  // carries a statusCode and code, so the contract test can never be used as a
  // way to smuggle a DB message out.
  it('a value-embedding error is suppressed even when it declares a contract', async () => {
    class DrizzleQueryError extends Error {
      readonly statusCode = 503;
      readonly code = 'LOOKS_LEGITIMATE';
      constructor() {
        super('Failed query: select 1\nparams: zzqx-fictional-param-9f3a1b');
      }
    }
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'development' }));
    app.get('/sneaky', { config: { public: true } }, () => {
      throw new DrizzleQueryError();
    });

    const response = await app.inject({ method: 'GET', url: '/sneaky' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(response.payload).not.toContain('zzqx-fictional-param-9f3a1b');
  });

  // M15-04 (FINDING-A), D5 legs 1+2. The sentinel is a nonsense token that
  // appears nowhere else in the repo, standing in for what the real incident
  // carried (a bound parameter holding an LLM response). FICTIONAL by
  // construction -- no real profile data is involved at any point (plan D4).
  describe('unhandled DB errors never leak the query or its parameters', () => {
    const SENTINEL = 'zzqx-fictional-param-9f3a1b';

    // Faithful double of drizzle-orm 0.45.2's DrizzleQueryError: the query and
    // params are interpolated INTO the message AND kept as own enumerable
    // properties, which is what defeats redacting either one alone. Declared
    // locally rather than imported so drizzle stays out of apps/api (module
    // wall) -- the serializer matches on the constructor NAME, so the name is
    // the load-bearing part and it matches exactly.
    class DrizzleQueryError extends Error {
      constructor(
        readonly query: string,
        readonly params: unknown[],
        cause?: Error,
      ) {
        // String(params) is exactly what the real class's template
        // interpolation does to its array.
        super(`Failed query: ${query}\nparams: ${String(params)}`);
        if (cause) this.cause = cause;
      }
    }

    async function buildWithDbBoom() {
      const lines: string[] = [];
      // TEST_ENV pins LOG_LEVEL=fatal to keep expected-error noise down; this
      // suite MUST see the error line, or its "sentinel absent" assertions
      // would pass vacuously against an empty stream.
      const app = await buildApp(
        parseEnv({ ...TEST_ENV, LOG_LEVEL: 'error', NODE_ENV: 'development' }),
        {
          logStream: { write: (line: string) => void lines.push(line) },
        },
      );
      app.get('/db-boom', { config: { public: true } }, () => {
        const cause = Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'profile_facts_pkey',
          table: 'profile_facts',
          detail: `Key (claim)=(${SENTINEL}) already exists.`,
        });
        throw new DrizzleQueryError(
          'insert into "profile_facts" ("claim") values ($1)',
          [SENTINEL],
          cause,
        );
      });
      return { app, lines };
    }

    it('keeps the sentinel out of the response body AND the log record', async () => {
      const { app, lines } = await buildWithDbBoom();
      const response = await app.inject({ method: 'GET', url: '/db-boom' });

      expect(response.statusCode).toBe(500);
      // Guard: a log line must actually have been captured, or "no sentinel"
      // would be vacuously true against empty input.
      expect(lines.length).toBeGreaterThan(0);
      const logged = lines.join('\n');

      expect(response.payload).not.toContain(SENTINEL);
      expect(logged).not.toContain(SENTINEL);
      // The SQL text itself is not secret, but it rides the same message that
      // carries the params, so its absence is the proof the message was cut.
      expect(logged).not.toContain('insert into');
      // pg embeds values in `detail` -- it must not be admitted from `cause`.
      expect(logged).not.toContain('already exists');
    });

    it('stays diagnosable: type, frames, and value-free cause fields survive', async () => {
      const { app, lines } = await buildWithDbBoom();
      await app.inject({ method: 'GET', url: '/db-boom' });

      expect(lines.length).toBeGreaterThan(0);
      const record = lines
        .map((line) => JSON.parse(line) as { err?: Record<string, unknown> })
        .find((entry) => entry.err !== undefined);

      expect(record?.err).toBeDefined();
      const err = record?.err as Record<string, unknown>;
      expect(err.type).toBe('DrizzleQueryError');
      expect(err.stack).toMatch(/\n\s+at /); // frames kept -- still debuggable
      expect(err.cause).toEqual({
        code: '23505',
        constraint: 'profile_facts_pkey',
        table: 'profile_facts',
      });
      // The allow-list is closed: the properties that carried the payload are
      // absent entirely, not merely emptied.
      expect(err).not.toHaveProperty('query');
      expect(err).not.toHaveProperty('params');
    });
  });

  it('in production, intentional 4xx errors still pass their message through', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'production' }));
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { ...ORIGIN_HEADER },
      body: { email: 42 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'body/email: invalid_type; body/password: invalid_type',
      },
    });
  });

  it('validation errors carry paths + issue codes only — an enum mismatch never echoes the value', async () => {
    // Architectural never-echo (M0-09): the handler must not pass
    // zod issue.message through — enum/literal messages quote the received
    // value, and a future enum field (M1 posting statuses) would otherwise
    // silently start echoing request content.
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'test' }));
    app.post(
      '/enum-probe',
      {
        config: { public: true },
        schema: { body: z.object({ status: z.enum(['active', 'archived']) }) },
      },
      () => ({ ok: true }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/enum-probe',
      headers: { ...ORIGIN_HEADER },
      body: { status: 'S3CRET-submitted-value' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(response.payload).not.toContain('S3CRET-submitted-value');
  });
});

describe('/docs (M0-09, dev-only)', () => {
  it('serves the docs UI and the generated spec outside production', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'development' }));

    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(ui.statusCode); // swagger-ui may redirect /docs → /docs/

    const spec = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(200);
    const body = spec.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toContain('/health');
  });

  it('does not exist in production — 404, so no auth exemption exists either', async () => {
    const app = await buildApp(parseEnv({ ...TEST_ENV, NODE_ENV: 'production' }));
    for (const url of ['/docs', '/docs/json']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
    }
  });
});

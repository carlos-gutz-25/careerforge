// M13-10 - Route user-scoping assertion harness.
//
// Makes the copy-the-wrong-template data-scoping hazard STRUCTURAL: every
// non-public route handler must READ request.user, or carry a deliberate,
// reasoned exemption. Deferred from M13-08 because route METADATA cannot see
// handler behavior - this closes that gap by scanning route.handler.toString()
// at onRoute time (the additive `handlerSource` seam field, app.ts).
//
// HONESTY ABOUT THE BAR (D3): this is a LEXICAL consultation check, exactly the
// BACKLOG bar ("consults request.user.id"). It proves the handler READS the
// user, not that every query is correctly filtered - semantic scoping stays on
// tests and review, and a comment mentioning request.user would satisfy it
// (accepted, disclosed residual; the planted-FAIL proves the net catches the
// real hazard shape). The 401 root guard (auth.hooks) remains the security
// boundary; this harness targets the data-scoping template hazard above it.
//
// ZERO PRODUCTION CHANGE (D5): the seam fields are test-consumed only.
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb } from '@careerforge/db/test-utils';

import { type AppDeps, buildApp } from './app.ts';
import { buildTestEnv } from './test/auth-test-helpers.ts';

const handle = createTestDb();
const env = buildTestEnv();

afterAll(async () => {
  await handle.pool.end();
});

type Route = {
  method: string | string[];
  url: string;
  public: boolean;
  handlerSource: string;
  userScopingExempt: string | undefined;
};

// Read the live getters (public, userScopingExempt) AFTER ready() - scoped
// hooks (the /docs plugin) finalize config after the root collector fires, so
// a pre-ready read misclassifies them (same rule the allowlist test relies on).
async function collectRoutes(deps: AppDeps = {}): Promise<Route[]> {
  const raw: Route[] = [];
  const app = await buildApp(env, { dbHandle: handle, onRoute: (r) => raw.push(r), ...deps });
  await app.ready();
  const routes = raw.map((r) => ({
    method: r.method,
    url: r.url,
    public: r.public,
    handlerSource: r.handlerSource,
    userScopingExempt: r.userScopingExempt,
  }));
  await app.close();
  return routes;
}

const CONSULTS_USER = /request\.user\b/;

// Non-public routes whose config we CANNOT attach a marker to (registered by a
// plugin, not by us) are exempted here by enumeration, each with a reason - the
// only mechanism available when `config` is out of reach. Keep this MINIMAL: a
// route WE register declares `config: { userScopingExempt: '<reason>' }` instead
// (see /auth/logout). Both paths require a non-empty reason (D2).
const INFRA_EXEMPT: Record<string, string> = {
  'OPTIONS *':
    'CORS preflight (@fastify/cors) - returns preflight headers only; no handler body scopes user data',
};

// A non-public route is user-scoping-clean iff its handler reads request.user
// OR it carries a non-empty reasoned exemption (config marker, else INFRA_EXEMPT).
function scopingOffender(r: Route): string | undefined {
  if (r.public || CONSULTS_USER.test(r.handlerSource)) return undefined;
  const key = `${String(r.method)} ${r.url}`;
  const reason = (r.userScopingExempt ?? INFRA_EXEMPT[key])?.trim();
  return reason ? undefined : key;
}

describe('M13-10 route user-scoping harness', () => {
  it('every non-public route consults request.user or carries a reasoned exemption', async () => {
    const routes = await collectRoutes();
    const offenders = routes.map(scopingOffender).filter((k): k is string => k !== undefined);
    expect(
      offenders,
      'non-public route(s) that neither read request.user nor carry a reasoned exemption - a data-scoping template hazard (M13-10)',
    ).toEqual([]);
  });

  it('the reasoned exemptions are EXACTLY the two userless non-public routes (drift guard)', async () => {
    // Pins the exempt set so a NEW exemption - the natural place to hide a route
    // that dodges user-scoping - cannot land silently; it fails here until
    // deliberately added. /auth/logout acts on the session token; OPTIONS * is
    // CORS preflight. Neither reads request.user; both are reasoned.
    const routes = await collectRoutes();
    const exempted = routes
      .filter((r) => !r.public && !CONSULTS_USER.test(r.handlerSource))
      .map((r) => `${String(r.method)} ${r.url}`)
      .sort();
    expect(exempted).toEqual(['OPTIONS *', 'POST /auth/logout']);
  });
});

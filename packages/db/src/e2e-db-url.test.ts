import { describe, expect, it } from 'vitest';

import { resolveE2eDatabaseUrl } from './e2e-db-url.ts';

// The parallel-dev harness assertion (M5-03): the e2e scratch DB is derived by
// default but overridable per worktree, so concurrent lanes never share one
// careerforge_e2e. env is passed explicitly, so these are pure and need no DB.
describe('resolveE2eDatabaseUrl', () => {
  it('defaults to the DATABASE_URL name suffixed _e2e', () => {
    const url = resolveE2eDatabaseUrl({
      DATABASE_URL: 'postgres://u:pw@localhost:5432/careerforge',
    });
    expect(new URL(url).pathname).toBe('/careerforge_e2e');
  });

  it('appends TEST_DB_SUFFIX to the derived name (the per-lane knob)', () => {
    const url = resolveE2eDatabaseUrl({
      DATABASE_URL: 'postgres://u:pw@localhost:5432/careerforge',
      TEST_DB_SUFFIX: '_a1',
    });
    expect(new URL(url).pathname).toBe('/careerforge_e2e_a1');
  });

  it('honors an explicit E2E_DATABASE_URL override outright', () => {
    const override = 'postgres://u:pw@localhost:5432/careerforge_e2e_lane_a1';
    const url = resolveE2eDatabaseUrl({
      DATABASE_URL: 'postgres://u:pw@localhost:5432/careerforge',
      E2E_DATABASE_URL: override,
      // The full-URL override wins even if a suffix is also set — no suffixing
      // on top of it.
      TEST_DB_SUFFIX: '_a1',
    });
    expect(url).toBe(override);
  });

  it('strips a trailing slash before suffixing', () => {
    const url = resolveE2eDatabaseUrl({
      DATABASE_URL: 'postgres://u:pw@localhost:5432/careerforge/',
    });
    expect(new URL(url).pathname).toBe('/careerforge_e2e');
  });

  it('throws naming both variables when neither is set', () => {
    expect(() => resolveE2eDatabaseUrl({})).toThrow(/DATABASE_URL.*E2E_DATABASE_URL/s);
  });
});

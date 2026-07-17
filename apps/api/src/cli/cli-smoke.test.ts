// Direct-node smoke guard for every CLI entry point, in two assertion modes
// sharing one strip-only tripwire (strip-incompatible syntax anywhere in a
// CLI's module graph surfaces as a SyntaxError instead of the expected
// output):
//   env-required CLIs run under an empty env and must fail cleanly — exit 1
//   and a message naming the missing variable;
//   env-free CLIs (openapi:generate reads no env by design — the spec cannot
//   depend on configuration) must instead SUCCEED under the empty env — exit
//   0 and the expected stdout shape.
// No DB, no secrets: an empty env has nothing to leak, and nothing connects.
//
// Coverage depends on one assumption: every CLI imports its full module graph
// STATICALLY, so ES module linking loads every transitive module before the
// env check runs. A dynamic import() anywhere in a graph would silently drop
// that subtree from coverage — this test would stay green while no longer
// guarding it. (Verified no dynamic imports as of 2026-07-14; a lint rule to
// enforce it is parked in BACKLOG, decision deferred.)
//
// The guard deliberately spawns process.execPath — whichever Node executes
// this test run — with no version assertion: local dev and .nvmrc-pinned CI
// each test the CLIs under the exact Node binary that runs them in that
// environment, which is the property that matters for strip-only semantics.
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = new URL('../../../../', import.meta.url);
const cliPath = (relative: string) => fileURLToPath(new URL(relative, repoRoot));

const ENV_REQUIRED_CLIS = [
  { name: 'db:migrate', path: 'packages/db/src/cli/migrate.ts', expects: ['DATABASE_URL'] },
  { name: 'db:seed', path: 'packages/db/src/cli/seed.ts', expects: ['DATABASE_URL'] },
  // The e2e database lifecycle CLI (M1-02): env check runs before the
  // command check, so the arg-less empty-env run reports the variable.
  { name: 'db:e2e', path: 'packages/db/src/cli/e2e-db.ts', expects: ['DATABASE_URL'] },
  {
    name: 'profile:import',
    path: 'apps/api/src/cli/import-profile.ts',
    expects: ['DATABASE_URL'],
  },
  {
    name: 'auth:sync-bootstrap',
    path: 'apps/api/src/cli/sync-bootstrap-password.ts',
    // parseEnv reports every missing variable in one message.
    expects: ['DATABASE_URL', 'AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD'],
  },
  // The M1-06 quote-verification backfill: DATABASE_URL only (deliberately
  // not parseEnv — it has no business demanding AUTH_BOOTSTRAP_* vars).
  {
    name: 'extraction:verify-quotes',
    path: 'apps/api/src/cli/verify-quotes.ts',
    expects: ['DATABASE_URL'],
  },
  // The manual live smoke (M1-04): env check via parseLlmEnv runs before any
  // provider construction, so the empty-env run names the key variable and
  // provably cannot place a live call.
  { name: 'llm:smoke', path: 'packages/llm/src/cli/live-smoke.ts', expects: ['ANTHROPIC_API_KEY'] },
  // The adversarial live pass (M1-07): same parseLlmEnv-first contract, so the
  // empty-env run names the key and provably cannot place a live call against
  // the corpus.
  {
    name: 'llm:adversarial-smoke',
    path: 'packages/llm/src/cli/adversarial-smoke.ts',
    expects: ['ANTHROPIC_API_KEY'],
  },
] as const;

async function runWithEmptyEnv(cliRelativePath: string, args: string[] = []) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath(cliRelativePath), ...args],
      {
        env: {},
        timeout: 30_000,
      },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failed.code ?? -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

describe.each(ENV_REQUIRED_CLIS)('direct-node smoke: $name', ({ path: cli, expects }) => {
  it('loads under direct node and fails cleanly on the empty env', async () => {
    const { exitCode, stdout, stderr } = await runWithEmptyEnv(cli);

    expect(exitCode).toBe(1);
    for (const variable of expects) {
      expect(stderr).toContain(variable);
    }
    // A strip-only syntax error in the module graph would land here instead
    // of the clean env message.
    expect(stderr).not.toContain('SyntaxError');
    expect(stdout).toBe('');
  });
});

describe('direct-node smoke: openapi:generate (env-free)', () => {
  it('loads under direct node and succeeds on the empty env', async () => {
    // --out points at a temp dir so the smoke can never regenerate the
    // committed docs/api/openapi.json in place — that would mask exactly the
    // drift openapi-drift.test.ts exists to catch.
    const outDir = await mkdtemp(path.join(tmpdir(), 'openapi-smoke-'));
    const outFile = path.join(outDir, 'openapi.json');

    const { exitCode, stdout, stderr } = await runWithEmptyEnv(
      'apps/api/src/cli/generate-openapi.ts',
      ['--out', outFile],
    );

    // This CLI has the largest module graph of any (app.ts + type provider +
    // every route), so it is the strongest strip-only tripwire of the set.
    expect(stderr).not.toContain('SyntaxError');
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^wrote .+openapi\.json \(\d+ paths\)\n$/);
  });
});

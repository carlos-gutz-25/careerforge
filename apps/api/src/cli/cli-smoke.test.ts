// Direct-node smoke guard for every CLI entry point: each one must load and
// fail cleanly under `node <cli>.ts` with an empty env — exit 1 and a message
// naming the missing variable. This is the type-stripping tripwire: strip-
// incompatible syntax anywhere in a CLI's module graph surfaces here as a
// SyntaxError instead of the expected message.
// No DB, no secrets: an empty env has nothing to leak.
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
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = new URL('../../../../', import.meta.url);
const cliPath = (relative: string) => fileURLToPath(new URL(relative, repoRoot));

const CLIS = [
  { name: 'db:migrate', path: 'packages/db/src/cli/migrate.ts', expects: ['DATABASE_URL'] },
  { name: 'db:seed', path: 'packages/db/src/cli/seed.ts', expects: ['DATABASE_URL'] },
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
] as const;

async function runWithEmptyEnv(path: string) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath(path)], {
      env: {},
      timeout: 30_000,
    });
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

describe.each(CLIS)('direct-node smoke: $name', ({ path, expects }) => {
  it('loads under direct node and fails cleanly on the empty env', async () => {
    const { exitCode, stdout, stderr } = await runWithEmptyEnv(path);

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

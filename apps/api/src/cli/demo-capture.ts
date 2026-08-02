// `pnpm demo:capture` (M10-03) - operator-attended, LOCAL, LIVE-key capture.
//
// Drives the REAL pipeline once, on a throwaway scratch database, over the
// fictional DEMO_POSTINGS against the fictional example profile, and exports the
// results as a committed fixture set + manifest. `demo:seed` (keyless) later
// replays those fixtures, so the public demo never calls the provider. Fixture
// content is derived ONLY from fictional inputs (RISKS P-01); stdout carries
// counts/ids/statuses only - never posting or artifact text.
//
// The pipeline body lives in ./demo/capture.ts (runDemoCapture), extracted so a
// keyless mocked-provider test can exercise it (see demo/capture.test.ts). This
// file is the thin CLI shell: env preconditions, scratch-DB lifecycle, the live
// provider, and the fixture-file write.
//
// Preconditions: ANTHROPIC_API_KEY present, DEMO_MODE OFF (a keyed demo cannot
// boot - see env.ts), a reachable local Postgres. Never touches the dev DB: it
// creates, migrates, and drops its own `careerforge_demo_capture` scratch DB.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb, runMigrations } from '@careerforge/db';
import { createAnthropicProvider } from '@careerforge/llm';

import { runDemoCapture, FIXTURE_SET_VERSION } from './demo/capture.ts';

const SCRATCH_DB = 'careerforge_demo_capture';
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const fixturesDir = path.join(repoRoot, 'apps/api/src/cli/demo/fixtures');
const profileDir = path.join(repoRoot, 'docs/profile.example');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function fail(message: string): never {
  process.stderr.write(`demo:capture: ${message}\n`);
  process.exit(1);
}

// --- preconditions ----------------------------------------------------------
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) fail('ANTHROPIC_API_KEY is required for a live capture (it is a paid run).');
if (process.env.DEMO_MODE === '1')
  fail('DEMO_MODE must be OFF for capture (a keyed demo cannot boot).');
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) fail('DATABASE_URL is not set - .env.example documents it.');
const model = process.env.LLM_MODEL ?? 'claude-sonnet-5';

const scratchUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${SCRATCH_DB}`;
  return u.toString();
})();
const adminUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = '/postgres';
  return u.toString();
})();

// Maintenance connection to the `postgres` DB (via packages/db's pool, so
// apps/api needs no direct pg dependency) - for CREATE/DROP of the scratch DB.
async function withAdmin(
  fn: (query: (sql: string) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const admin = createDb(adminUrl);
  try {
    await fn((sql) => admin.pool.query(sql));
  } finally {
    await admin.pool.end();
  }
}

async function main(): Promise<void> {
  // Fresh scratch DB.
  await withAdmin(async (query) => {
    await query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await query(`CREATE DATABASE ${SCRATCH_DB}`);
  });
  await runMigrations(scratchUrl);
  out(`scratch DB ${SCRATCH_DB} created + migrated`);

  const { db, pool } = createDb(scratchUrl);
  try {
    const provider = createAnthropicProvider({ apiKey: apiKey as string, model });
    const { fixtureSet, strongestSlug, usage } = await runDemoCapture({
      db,
      provider,
      profileDir,
      log: out,
    });

    // Write the fixture set + manifest.
    mkdirSync(fixturesDir, { recursive: true });
    const setJson = `${JSON.stringify(fixtureSet, null, 2)}\n`;
    const setPath = path.join(fixturesDir, 'demo-fixture-set.json');
    writeFileSync(setPath, setJson);
    const manifest = {
      fixtureSetVersion: FIXTURE_SET_VERSION,
      capturedAt: new Date().toISOString(),
      strongestSlug,
      fixtureManifestSha256: createHash('sha256').update(setJson).digest('hex'),
      usage,
    };
    writeFileSync(
      path.join(fixturesDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    out('');
    out(`fixture set written: ${path.relative(repoRoot, setPath)}`);
    out(`manifest sha256: ${manifest.fixtureManifestSha256}`);
    out(
      `LLM usage: ${String(usage.calls)} calls, ${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out / ${String(usage.cacheReadInputTokens)} cache-read tokens`,
    );
  } finally {
    await pool.end();
    await withAdmin(async (query) => {
      await query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    });
    out(`scratch DB ${SCRATCH_DB} dropped`);
  }
}

await main();

// `pnpm demo:seed` (M10-03) - keyless demo provisioning.
//
// Replays the committed fixture set into the bootstrap user (recomputing fit
// live at seed time), so the public demo serves pre-generated artifacts without
// ever calling the provider. Requires DEMO_MODE=1 (it must be impossible to
// demo-seed a real instance); runDemoSeed additionally refuses at the DATA level
// (amendment 3) if the target user has rows but no demo_seed_state marker.
// Idempotent - safe to re-run (the nightly reset is truncate + demo:seed).
// Output: counts/ids/statuses only, never posting or artifact text (RISKS P-01).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb, createUsersRepository, type DemoSeedMarker } from '@careerforge/db';

import { passwords } from '../modules/auth/passwords.ts';
import { runDemoSeed, DemoSeedRefusedError } from './demo/seed.ts';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const fixturesDir = path.join(repoRoot, 'apps/api/src/cli/demo/fixtures');
const profileDir = path.join(repoRoot, 'docs/profile.example');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function fail(message: string): never {
  process.stderr.write(`demo:seed: ${message}\n`);
  process.exit(1);
}

// --- preconditions ----------------------------------------------------------
if (process.env.DEMO_MODE !== '1') fail('DEMO_MODE must be 1 (demo:seed only provisions a demo).');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set - .env.example documents it.');
const bootstrapEmail = process.env.AUTH_BOOTSTRAP_EMAIL;
if (!bootstrapEmail) fail('AUTH_BOOTSTRAP_EMAIL is not set - .env.example documents it.');
const bootstrapPassword = process.env.AUTH_BOOTSTRAP_PASSWORD;
if (!bootstrapPassword) fail('AUTH_BOOTSTRAP_PASSWORD is not set - .env.example documents it.');

const fixtureSet: unknown = JSON.parse(
  readFileSync(path.join(fixturesDir, 'demo-fixture-set.json'), 'utf8'),
);
const manifestFile = JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8')) as {
  fixtureSetVersion: string;
  fixtureManifestSha256: string;
};
const manifest: DemoSeedMarker = {
  fixtureSetVersion: manifestFile.fixtureSetVersion,
  fixtureManifestSha256: manifestFile.fixtureManifestSha256,
};

const { db, pool } = createDb(databaseUrl);
try {
  // Ensure the bootstrap user (the published demo login) exists - the seed runs
  // before the API boots, so it cannot rely on main.ts's ensureBootstrapUser.
  const users = createUsersRepository(db);
  const user =
    (await users.findByEmail(bootstrapEmail)) ??
    (await users.create({
      email: bootstrapEmail,
      passwordHash: await passwords.hashPassword(bootstrapPassword),
    }));

  const summary = await runDemoSeed({
    db,
    userId: user.id,
    fixtureSet,
    manifest,
    profileDir,
    log: out,
  });

  out('');
  out(
    `seeded ${String(summary.postings)} postings, ${String(summary.requirements)} requirements, ${String(summary.fitReports)} fit reports, ${String(summary.gaps)} gaps`,
  );
  for (const a of summary.artifacts) out(`  ${a.family}: ${a.reviewStatus}`);
  out(`fixture ${manifest.fixtureSetVersion} (sha ${manifest.fixtureManifestSha256.slice(0, 12)})`);
} catch (error) {
  if (error instanceof DemoSeedRefusedError) fail(error.message);
  const message = error instanceof Error ? error.message : String(error);
  fail(`demo seed failed: ${message}\n(is the schema migrated? pnpm db:migrate)`);
} finally {
  await pool.end();
}

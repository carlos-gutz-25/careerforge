// CLI entry for `pnpm profile:import` — parses the profile markdown into the
// profile tables. Default: the real, gitignored docs/profile/ into the
// AUTH_BOOTSTRAP_EMAIL user (run manually; tests never execute this path).
// --example: docs/profile.example/ into the fictional seed user instead.
// Plain writes, not pino: terminal tool, not the service log stream. Output
// carries counts and parse locations only — never parsed profile values.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDb,
  createProfileRepository,
  createUsersRepository,
  SEED_USER_EMAIL,
} from '@careerforge/db';

import { ProfileParseError } from '../modules/profile/parse-errors.ts';
import { createProfileImportService } from '../modules/profile/profile.service.ts';

const example = process.argv.includes('--example');
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const profileDir = path.join(repoRoot, 'docs', example ? 'profile.example' : 'profile');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set — .env.example documents it.\n');
  process.exit(1);
}
const email = example ? SEED_USER_EMAIL : process.env.AUTH_BOOTSTRAP_EMAIL;
if (!email) {
  process.stderr.write('AUTH_BOOTSTRAP_EMAIL is not set — .env.example documents it.\n');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const user = await createUsersRepository(db).findByEmail(email);
  if (!user) {
    process.stderr.write(
      example
        ? 'example seed user not found — run `pnpm db:seed` first.\n'
        : 'bootstrap user not found — start the API once (`pnpm dev`) to create it.\n',
    );
    process.exit(1);
  }
  const service = createProfileImportService({
    profileDir,
    profile: createProfileRepository(db),
  });
  const { sync, totals } = await service.importProfile(user.id);
  const label = example ? 'example profile (fictional)' : 'profile';
  const changes = (table: 'skills' | 'experiences' | 'projects') =>
    `${totals[table]} ${table} (+${sync[table].inserted} ~${sync[table].updated} -${sync[table].deleted})`;
  process.stdout.write(
    `imported ${label} from ${profileDir}:\n  ${changes('skills')}\n  ${changes('experiences')}\n  ${changes('projects')}\n`,
  );
} catch (error) {
  if (error instanceof ProfileParseError) {
    process.stderr.write('profile sources failed to parse — nothing was imported:\n');
    for (const issue of error.issues) {
      process.stderr.write(`  ${issue.file}:${issue.line} — ${issue.message}\n`);
    }
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `profile import failed: ${message}\n(is the schema migrated? pnpm db:migrate)\n`,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}

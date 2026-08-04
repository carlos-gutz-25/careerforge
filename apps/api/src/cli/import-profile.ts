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
  createProfileFactsRepository,
  createProfileRepository,
  createSearchCriteriaRepository,
  createUsersRepository,
  SEED_USER_EMAIL,
} from '@careerforge/db';

import { ProfileParseError } from '../modules/profile/parse-errors.ts';
import { createProfileSnapshot } from '../modules/profile/profile-snapshot.ts';
import {
  createProfileImportService,
  ImportConfirmationError,
  SnapshotUnavailableError,
  type ImportPreview,
  type ProfileImportSummary,
} from '../modules/profile/profile.service.ts';

const example = process.argv.includes('--example');
// --force: overwrite a DIFFERING existing criteria row (M1-08 collision rule,
// confirmation-gated). CLI-only by design — the HTTP import route never forces.
const force = process.argv.includes('--force');
// M13-09 (F-7) flags:
//   --dry-run              preview the deltas + fingerprint, write NOTHING.
//   --confirm-deletes <fp> authorize a DESTRUCTIVE import; <fp> is the fingerprint
//                          printed by the preview (rejected if the sources changed).
//   --no-snapshot          skip the pre-destructive docs/profile/ snapshot (a
//                          visible operator override for an unconfigured BACKUP_DIR).
const dryRun = process.argv.includes('--dry-run');
const noSnapshot = process.argv.includes('--no-snapshot');
function flagValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}
const confirmDeletes = flagValue('--confirm-deletes');
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const profileDir = path.join(repoRoot, 'docs', example ? 'profile.example' : 'profile');

// Fail-closed (M10-03 D7c): never import the REAL profile into a demo instance.
// Defense in depth - the real docs/profile/ is already absent from the demo
// image (.dockerignore) - but the process guard makes an accidental real import
// on a DEMO_MODE host impossible. The fictional --example path stays allowed.
if (!example && process.env.DEMO_MODE === '1') {
  process.stderr.write('DEMO_MODE is on - refusing to import the real profile (use demo:seed).\n');
  process.exit(1);
}

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
  // The real path wires the pre-destructive snapshot (M13-09); --example never
  // triggers it (raw importProfile bypasses the guard entirely).
  const service = createProfileImportService({
    profileDir,
    profile: createProfileRepository(db),
    facts: createProfileFactsRepository(db),
    criteria: createSearchCriteriaRepository(db),
    snapshotProfile: createProfileSnapshot(repoRoot),
  });

  // Value-free delta lines shared by the summary + the preview (counts only -
  // profile VALUES never reach stdout, RISKS P-01).
  const deltaLines = (sync: ProfileImportSummary['sync'], facts: ProfileImportSummary['facts']) => [
    `skills (+${sync.skills.inserted} ~${sync.skills.updated} -${sync.skills.deleted})`,
    `experiences (+${sync.experiences.inserted} ~${sync.experiences.updated} -${sync.experiences.deleted})`,
    `bullets (+${sync.bullets.inserted} ~${sync.bullets.updated} -${sync.bullets.deleted})`,
    `projects (+${sync.projects.inserted} ~${sync.projects.updated} -${sync.projects.deleted})`,
    `contact (+${sync.contact.inserted} ~${sync.contact.updated} -${sync.contact.deleted})`,
    `summaries (+${sync.summaries.inserted} ~${sync.summaries.updated} -${sync.summaries.deleted})`,
    `education (+${sync.education.inserted} ~${sync.education.updated} -${sync.education.deleted})`,
    `facts (+${facts.inserted} ~${facts.updated} -${facts.deleted})`,
  ];

  const printSummary = (summary: ProfileImportSummary) => {
    const label = example ? 'example profile (fictional)' : 'profile';
    const criteriaLine =
      summary.criteria.outcome === 'skipped_existing'
        ? 'criteria: skipped (existing row differs from the source - rerun with --force to overwrite)'
        : `criteria: ${summary.criteria.outcome}`;
    process.stdout.write(
      `imported ${label} from ${profileDir}:\n` +
        deltaLines(summary.sync, summary.facts)
          .map((line) => `  ${line}`)
          .join('\n') +
        `\n  ${criteriaLine}\n`,
    );
  };

  const printPreview = (preview: ImportPreview) => {
    process.stdout.write(
      `preview of importing ${profileDir} (NOTHING was written):\n` +
        deltaLines(preview.sync, preview.facts)
          .map((line) => `  ${line}`)
          .join('\n') +
        `\n  destructive: ${preview.destructive ? 'YES - this import would DELETE rows' : 'no'}\n` +
        `  fingerprint: ${preview.fingerprint}\n`,
    );
  };

  if (example) {
    // Fictional data: no guard, no snapshot (IN3 bypass).
    printSummary(await service.importProfile(user.id, { forceCriteria: force }));
  } else {
    const preview = await service.previewImport(user.id);
    if (dryRun) {
      printPreview(preview);
    } else if (preview.destructive && confirmDeletes === undefined) {
      // Refuse to proceed unconfirmed: show what WOULD be deleted + the token.
      printPreview(preview);
      process.stderr.write(
        `\nThis import would DELETE profile rows - nothing was changed.\n` +
          `docs/profile/ is gitignored and has no history, so re-run to confirm you\n` +
          `have reviewed the deletions above:\n` +
          `  pnpm profile:import --confirm-deletes ${preview.fingerprint}\n` +
          `(a snapshot of docs/profile/ is taken first; add --no-snapshot to skip it)\n`,
      );
      process.exitCode = 1;
    } else {
      try {
        const summary = await service.importGuarded(user.id, {
          forceCriteria: force,
          confirmDeletes,
          skipSnapshot: noSnapshot,
        });
        printSummary(summary);
      } catch (error) {
        if (error instanceof ImportConfirmationError) {
          process.stderr.write(`profile import refused: ${error.message}\n`);
          if (error.reason === 'fingerprint_mismatch') {
            process.stderr.write(
              `Re-run \`pnpm profile:import --dry-run\` for the current fingerprint, then confirm.\n`,
            );
          }
          process.exitCode = 1;
        } else if (error instanceof SnapshotUnavailableError) {
          process.stderr.write(
            `profile import refused: ${error.message}\n` +
              `Configure BACKUP_DIR (see .env.example) so docs/profile/ can be snapshotted,\n` +
              `or re-run with --no-snapshot to import without a snapshot.\n`,
          );
          process.exitCode = 1;
        } else {
          throw error;
        }
      }
    }
  }
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

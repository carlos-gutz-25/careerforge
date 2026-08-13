import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Dev-boot migration-drift check (M15-05, FINDING-B). Twice a developer has run
 * the app against a database missing a checked-in migration and paid for it in
 * live debugging - the app does not fail at boot, it fails later at whatever
 * statement first needs the missing column. This compares what is on disk with
 * what the database says it has applied, at boot, in development only.
 *
 * Counting is sufficient under the forward-only migration law (ADR-0003):
 * migrations are only ever appended, so if the two counts agree the sets agree.
 * This is a deliberate choice, not a shortcut around tag-level comparison.
 */

// Resolved relative to this file so it works from any cwd, matching migrate.ts.
const JOURNAL_PATH = path.join(import.meta.dirname, '..', 'migrations', 'meta', '_journal.json');

// `runMigrations` passes ONLY `migrationsFolder`, so drizzle's defaults decide
// where applied migrations are recorded. Verified firsthand against the SHIPPED
// migrator (drizzle-orm 0.45.2, pg-core/dialect.js): schema `drizzle`, table
// `__drizzle_migrations`, one row inserted per applied migration. If a future
// drizzle upgrade changes either default, this check goes INDETERMINATE (the
// table lookup fails) rather than reporting false drift.
const APPLIED_MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

/** Minimal shape of what this check needs from the drizzle handle. Narrow on
 *  purpose: it keeps the check unit-testable and means the boot call site can
 *  pass the `db` the app already exposes, without widening the app surface. */
interface Queryable {
  execute(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type MigrationDriftResult =
  /** Counts agree. */
  | { status: 'current'; applied: number; onDisk: number }
  /** Counts positively disagree - the only status that may stop a boot. */
  | { status: 'drifted'; applied: number; onDisk: number; message: string }
  /** Nothing could be established. NEVER fatal - see assertNoMigrationDrift. */
  | { status: 'indeterminate'; reason: string };

/** Environments where the check is inert: tests manage their own schema, and a
 *  production boot has already run migrations as a deploy step. */
function isCheckedEnvironment(nodeEnv: string): boolean {
  return nodeEnv !== 'test' && nodeEnv !== 'production';
}

/**
 * Pure comparison. Returns null when the counts agree, otherwise a message that
 * NAMES THE DIRECTION - a database ahead of the journal (an old checkout against
 * a newer database) is drift too, and it bites the same way.
 */
export function describeMigrationDrift(applied: number, onDisk: number): string | null {
  if (applied === onDisk) return null;
  const counts = `${applied} applied, ${onDisk} on disk`;
  if (applied < onDisk) {
    return (
      `migration drift: the database is BEHIND the checked-in migrations (${counts}). ` +
      `Run: pnpm db:migrate`
    );
  }
  return (
    `migration drift: the database is AHEAD of the checked-in migrations (${counts}) - ` +
    `this checkout is older than this database. Switch to the branch that carries them, ` +
    `then run: pnpm db:migrate`
  );
}

/** Number of migrations listed in the on-disk journal. */
async function readJournalCount(readJournal: () => Promise<string>): Promise<number> {
  const parsed: unknown = JSON.parse(await readJournal());
  const entries =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { entries?: unknown }).entries
      : null;
  if (!Array.isArray(entries)) throw new Error('journal has no entries[]');
  return entries.length;
}

/** Number of migrations the database records as applied. */
async function readAppliedCount(queryable: Queryable): Promise<number> {
  const result = await queryable.execute(
    `select count(*)::int as count from ${APPLIED_MIGRATIONS_TABLE}`,
  );
  const count = result.rows[0]?.count;
  if (typeof count !== 'number') throw new Error('applied-migrations count is not a number');
  return count;
}

/**
 * Establishes drift, or reports that it could not. ANY failure - unreachable
 * database, missing applied-migrations table on a fresh DB, unreadable journal -
 * resolves to `indeterminate`; this function never throws.
 */
export async function checkMigrationDrift(deps: {
  queryable: Queryable;
  readJournal?: () => Promise<string>;
}): Promise<MigrationDriftResult> {
  const readJournal = deps.readJournal ?? (() => readFile(JOURNAL_PATH, 'utf8'));
  try {
    const [onDisk, applied] = await Promise.all([
      readJournalCount(readJournal),
      readAppliedCount(deps.queryable),
    ]);
    const message = describeMigrationDrift(applied, onDisk);
    return message === null
      ? { status: 'current', applied, onDisk }
      : { status: 'drifted', applied, onDisk, message };
  } catch (error) {
    return { status: 'indeterminate', reason: error instanceof Error ? error.message : 'unknown' };
  }
}

/** Thrown only on POSITIVELY CONFIRMED drift, so a caller can exit loudly. */
export class MigrationDriftError extends Error {}

/**
 * Boot assertion, shaped after `assertDemoSeeded`: fail closed on confirmed
 * drift, and only then.
 *
 * The indeterminate/confirmed split is what makes failing closed safe. A check
 * that crashed a boot would be worse than the bug it detects, so an
 * indeterminate result costs at most one line and boot proceeds. Only a
 * confirmed mismatch throws, and the remedy is in the message.
 */
export async function assertNoMigrationDrift(deps: {
  nodeEnv: string;
  db: Queryable;
  note: (line: string) => void;
}): Promise<void> {
  if (!isCheckedEnvironment(deps.nodeEnv)) return;
  const result = await checkMigrationDrift({ queryable: deps.db });
  if (result.status === 'drifted') throw new MigrationDriftError(result.message);
  if (result.status === 'indeterminate') {
    deps.note(`migration-drift check skipped (${result.reason})`);
  }
}

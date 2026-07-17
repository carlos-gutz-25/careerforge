// CLI entry for `pnpm extraction:verify-quotes` — the M1-06 backfill: verify
// every stored requirement whose quote_verified is still NULL against its
// posting text, set per-row verdicts, and recompute run statuses (flagged iff
// any quote fails). Idempotent; new extractions verify inline, so this only
// ever shrinks the NULL population. Plain writes, not pino: terminal tool.
// Output carries counts/ids/statuses only — NEVER quote or posting text (this
// runs against the real database; the operator inspects flagged rows in their
// own SQL session by id).
import { createDb, createExtractionsRepository } from '@careerforge/db';

import { runQuoteBackfill } from '../modules/extraction/quote-backfill.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set — .env.example documents it.\n');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
try {
  const totals = await runQuoteBackfill(createExtractionsRepository(db), (line) => {
    process.stdout.write(`${line}\n`);
  });
  if (totals.runsProcessed === 0) {
    process.stdout.write('nothing to verify — no requirement-bearing run holds NULL verdicts.\n');
  } else {
    process.stdout.write(
      `verified ${String(totals.requirementsVerified)} requirement(s) across ` +
        `${String(totals.runsProcessed)} run(s): ` +
        `${String(totals.unverifiedRequirements)} unverified, ` +
        `${String(totals.runsFlagged)} run(s) flagged.\n`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `quote verification backfill failed: ${message}\n(is the schema migrated? pnpm db:migrate)\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

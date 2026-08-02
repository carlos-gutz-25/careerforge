import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// M10-03: demo_seed_state - the single-row marker that says "this instance was
// seeded with fictional example content by `demo:seed`". Written ONLY by
// demo:seed (the keyless seeder); read only by the DEMO_MODE fail-closed boot
// check (an unseeded demo must refuse to serve). A CHECK pins id = 1, so the
// table holds at most one row (a singleton). Additive, forward-only (migration
// 0025): a new table with zero rows at migrate time - no backfill, no hand-edit.
// It deliberately carries NO profile semantics (overloading a sensitive-class
// table like profile_facts with infrastructure state was rejected); local
// dev/test DBs simply never have a row, and nothing reads it outside the boot
// check. seeded_at IS this row's timestamp, so the created_at/updated_at helper
// is intentionally omitted.
export const demoSeedState = pgTable(
  'demo_seed_state',
  {
    id: integer().primaryKey(),
    seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
    // The fixture set the seed came from (manifest version + its hash) - the
    // reproducibility anchor recorded when the row is written.
    fixtureSetVersion: text('fixture_set_version').notNull(),
    fixtureManifestSha256: text('fixture_manifest_sha256').notNull(),
  },
  (table) => [check('demo_seed_state_singleton_check', sql`${table.id} = 1`)],
);

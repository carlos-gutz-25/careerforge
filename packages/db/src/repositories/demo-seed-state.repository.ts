import { eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { demoSeedState } from '../schema/demo-seed-state.ts';

// M10-03: the demo_seed_state singleton marker (id = 1). The ONLY module allowed
// SQL for this table. `demo:seed` is the sole writer (upsert, so a nightly
// re-seed refreshes it in place); the DEMO_MODE boot check is the sole reader.

export type DemoSeedStateRow = typeof demoSeedState.$inferSelect;

/** Provenance recorded when demo:seed writes the marker. */
export interface DemoSeedMarker {
  fixtureSetVersion: string;
  fixtureManifestSha256: string;
}

export interface DemoSeedStateRepository {
  /** The singleton marker, or undefined when the instance is unseeded. */
  read(): Promise<DemoSeedStateRow | undefined>;
  /** Write (or refresh) the singleton marker — id is always 1. Idempotent: a
   *  re-seed updates seeded_at + provenance in place. */
  upsert(marker: DemoSeedMarker): Promise<DemoSeedStateRow>;
}

export function createDemoSeedStateRepository(db: Db): DemoSeedStateRepository {
  return {
    async read() {
      const [row] = await db.select().from(demoSeedState).where(eq(demoSeedState.id, 1)).limit(1);
      return row;
    },

    async upsert(marker) {
      const [row] = await db
        .insert(demoSeedState)
        .values({ id: 1, seededAt: new Date(), ...marker })
        .onConflictDoUpdate({
          target: demoSeedState.id,
          set: { seededAt: new Date(), ...marker },
        })
        .returning();
      if (!row) throw new Error('demo_seed_state upsert returned no rows');
      return row;
    },
  };
}

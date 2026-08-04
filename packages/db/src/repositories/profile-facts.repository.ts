import { asc, eq } from 'drizzle-orm';
import { type ProfileFactKind } from '@careerforge/core';

import { type Db } from '../client.ts';
import { profileFacts } from '../schema/profile-facts.ts';
import { runRolledBack, type Tx } from './rolled-back-preview.ts';

// M12-03 (ADR-0021): the profile_facts read + full-sync repository. Routes →
// services → repositories: only this layer touches Drizzle for facts. Fact
// VALUES are a sensitive class and never leave a repository except on the
// GET /profile/facts read (escaped in the UI); they are NEVER logged.

export type ProfileFactRow = typeof profileFacts.$inferSelect;

/** One declared fact handed over by the importer (apps/api owns parsing;
 *  this repository owns how it lands in Postgres). */
export interface ProfileFactImport {
  kind: ProfileFactKind;
  value: string;
  note: string | null;
  /** The YYYY-MM-DD declared date from facts.md. */
  declaredAt: string;
}

export interface FactsSyncSummary {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface ProfileFactsRepository {
  /** All declared facts for a user, deterministic (kind asc) order. */
  listFacts(userId: string): Promise<ProfileFactRow[]>;
  /**
   * Idempotent FULL sync from facts.md (D-4: the file is the source of truth).
   * Upsert each present kind by the (user, kind) natural key; DELETE any kind
   * absent from `facts` (so removing a fact from the markdown removes the row).
   * One transaction — the profile skills full-sync precedent.
   */
  syncFacts(userId: string, facts: readonly ProfileFactImport[]): Promise<FactsSyncSummary>;
  /**
   * M13-09 (F-7): a preview of what `syncFacts` WOULD change (facts.md is a
   * full-sync too, so a shrunk file deletes rows - D-4), computed by the exact
   * same code path inside a transaction that always rolls back. No commit.
   */
  previewSyncFacts(userId: string, facts: readonly ProfileFactImport[]): Promise<FactsSyncSummary>;
}

export function createProfileFactsRepository(db: Db): ProfileFactsRepository {
  return {
    listFacts(userId) {
      return db
        .select()
        .from(profileFacts)
        .where(eq(profileFacts.userId, userId))
        .orderBy(asc(profileFacts.kind));
    },

    syncFacts(userId, facts) {
      return db.transaction((tx) => runFactsSync(tx, userId, facts));
    },
    previewSyncFacts(userId, facts) {
      return runRolledBack(db, (tx) => runFactsSync(tx, userId, facts));
    },
  };

  // Hoisted (function declaration): the SINGLE facts full-sync body - syncFacts
  // commits it, previewSyncFacts rolls it back (M13-09 parity, plan D1).
  async function runFactsSync(
    tx: Tx,
    userId: string,
    facts: readonly ProfileFactImport[],
  ): Promise<FactsSyncSummary> {
    const summary: FactsSyncSummary = { inserted: 0, updated: 0, deleted: 0 };
    const existing = await tx.select().from(profileFacts).where(eq(profileFacts.userId, userId));
    const existingByKind = new Map(existing.map((row) => [row.kind, row]));
    const keptKinds = new Set<string>();

    for (const fact of facts) {
      keptKinds.add(fact.kind);
      const current = existingByKind.get(fact.kind);
      if (!current) {
        await tx.insert(profileFacts).values({
          userId,
          kind: fact.kind,
          value: fact.value,
          note: fact.note,
          declaredAt: fact.declaredAt,
        });
        summary.inserted++;
      } else if (
        current.value !== fact.value ||
        current.note !== fact.note ||
        current.declaredAt !== fact.declaredAt
      ) {
        await tx
          .update(profileFacts)
          .set({ value: fact.value, note: fact.note, declaredAt: fact.declaredAt })
          .where(eq(profileFacts.id, current.id));
        summary.updated++;
      }
    }

    for (const row of existing) {
      if (keptKinds.has(row.kind)) continue;
      await tx.delete(profileFacts).where(eq(profileFacts.id, row.id));
      summary.deleted++;
    }

    return summary;
  }
}

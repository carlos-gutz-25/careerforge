import { type EvidenceKind } from '@careerforge/core';
import { EVIDENCE_KINDS } from '@careerforge/core';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { masteryEvidence } from '../schema/mastery.ts';

// M3-03: mastery-evidence persistence + reads. A USER-AUTHORED record that an
// exercise (M3-02) was done — plain CRUD, no LLM run table. The ONLY module
// allowed SQL (routes -> services -> repositories). Every query is user-scoped
// (ADR-0007). Two reads back cross-table SERVICE invariants: hasRequiredEvidence
// (the D1 completion gate) and countEvidenceByKind (the D2 airtight
// delete-guard). Both are exposed as NARROW read-only interfaces below so a
// consuming module cannot reach through the handle to mutate.

export type MasteryEvidenceRow = typeof masteryEvidence.$inferSelect;

/** The create input the service assembles after its precondition passes
 *  (exercise owned) and after resolving `recordedOn` (client value or server
 *  today) and validating it is not in the future. */
export interface CreateMasteryEvidenceInput {
  exerciseId: string;
  kind: EvidenceKind;
  artifactUrl: string | null;
  recordedOn: string;
}

/** Per-kind evidence counts for one exercise (0 for absent kinds). Powers the
 *  D1 gate (implemented>=1 && tested>=1) and the D2 delete-guard (is this the
 *  LAST implemented/tested row?). */
export type EvidenceKindCounts = Record<EvidenceKind, number>;

/** Narrow read-only view for the D1 completion gate — the ONLY method injected
 *  into the exercises service (read-only is type-enforced, not a convention). */
export interface MasteryEvidenceGateRead {
  /** True iff the exercise has >=1 `implemented` AND >=1 `tested` evidence row. */
  hasRequiredEvidence(userId: string, exerciseId: string): Promise<boolean>;
}

/** Narrow read-only view for the D4 embed — the ONLY method injected into the
 *  learning service. A single batched query, never per-exercise (no N+1). */
export interface MasteryEvidenceEmbedRead {
  /** Evidence rows for a set of exercises, grouped by exercise id, each group
   *  in (created_at, id) order. One `WHERE exercise_id IN (...)` query. */
  listEvidenceByExerciseIds(
    userId: string,
    exerciseIds: string[],
  ): Promise<Map<string, MasteryEvidenceRow[]>>;
}

export interface MasteryEvidenceRepository
  extends MasteryEvidenceGateRead, MasteryEvidenceEmbedRead {
  /** Insert one evidence row (owner-scoped). The service has already validated
   *  exercise ownership and resolved/validated `recordedOn`. */
  createEvidence(userId: string, input: CreateMasteryEvidenceInput): Promise<MasteryEvidenceRow>;

  /** One evidence row (owner-scoped), or undefined (404). Gives the row's
   *  `exerciseId` + `kind` for the D2 delete-guard. */
  findEvidence(userId: string, evidenceId: string): Promise<MasteryEvidenceRow | undefined>;

  /** Owner-scoped hard delete. Returns true iff a row was deleted (false = 404).
   *  The D2 delete-guard runs in the SERVICE before calling this. */
  deleteEvidence(userId: string, evidenceId: string): Promise<boolean>;

  /** Per-kind counts for one exercise — the D2 delete-guard's "is this the last
   *  implemented/tested?" read. */
  countEvidenceByKind(userId: string, exerciseId: string): Promise<EvidenceKindCounts>;
}

/** All-kinds-zero counts, the base every read fills in. */
function zeroCounts(): EvidenceKindCounts {
  return Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0])) as EvidenceKindCounts;
}

export function createMasteryEvidenceRepository(db: Db): MasteryEvidenceRepository {
  async function countsFor(userId: string, exerciseId: string): Promise<EvidenceKindCounts> {
    const rows = await db
      .select({ kind: masteryEvidence.kind, n: count() })
      .from(masteryEvidence)
      .where(and(eq(masteryEvidence.userId, userId), eq(masteryEvidence.exerciseId, exerciseId)))
      .groupBy(masteryEvidence.kind);
    const counts = zeroCounts();
    for (const row of rows) counts[row.kind] = Number(row.n);
    return counts;
  }

  return {
    async createEvidence(userId, input) {
      const [row] = await db
        .insert(masteryEvidence)
        .values({
          userId,
          exerciseId: input.exerciseId,
          kind: input.kind,
          artifactUrl: input.artifactUrl,
          recordedOn: input.recordedOn,
        })
        .returning();
      if (!row) throw new Error('mastery_evidence insert returned no rows');
      return row;
    },

    async findEvidence(userId, evidenceId) {
      const [row] = await db
        .select()
        .from(masteryEvidence)
        .where(and(eq(masteryEvidence.userId, userId), eq(masteryEvidence.id, evidenceId)))
        .limit(1);
      return row;
    },

    async deleteEvidence(userId, evidenceId) {
      const deleted = await db
        .delete(masteryEvidence)
        .where(and(eq(masteryEvidence.userId, userId), eq(masteryEvidence.id, evidenceId)))
        .returning({ id: masteryEvidence.id });
      return deleted.length > 0;
    },

    async listEvidenceByExerciseIds(userId, exerciseIds) {
      const grouped = new Map<string, MasteryEvidenceRow[]>();
      if (exerciseIds.length === 0) return grouped;
      const rows = await db
        .select()
        .from(masteryEvidence)
        .where(
          and(eq(masteryEvidence.userId, userId), inArray(masteryEvidence.exerciseId, exerciseIds)),
        )
        .orderBy(asc(masteryEvidence.createdAt), asc(masteryEvidence.id));
      for (const row of rows) {
        const list = grouped.get(row.exerciseId);
        if (list) list.push(row);
        else grouped.set(row.exerciseId, [row]);
      }
      return grouped;
    },

    async hasRequiredEvidence(userId, exerciseId) {
      const counts = await countsFor(userId, exerciseId);
      return counts.implemented >= 1 && counts.tested >= 1;
    },

    countEvidenceByKind(userId, exerciseId) {
      return countsFor(userId, exerciseId);
    },
  };
}

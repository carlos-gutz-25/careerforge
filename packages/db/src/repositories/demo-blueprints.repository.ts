import { type MarketSignalRef, type RequirementCategory } from '@careerforge/core';
import { and, desc, eq, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { demoBlueprints } from '../schema/demo-blueprints.ts';

// M9-04: demo-blueprint persistence + reads. A demo_blueprint is a
// deterministically-scaffolded working brief for a market-signal BUILD group
// (M9-02) - plain CRUD, no LLM run table. The ONLY module allowed SQL for this
// table (routes -> services -> repositories). Every query is user-scoped
// (ADR-0007). group_key_hash is a GENERATED md5(group_key) column, so the
// (user, group) dispatch computes md5 in SQL and the repository NEVER writes the
// hash directly. No narrow Pick<> view is exported: nothing outside the
// demo-blueprints service reads blueprints.

export type DemoBlueprintRow = typeof demoBlueprints.$inferSelect;

/** The full-replacement snapshot the service assembles for a create OR a refresh
 *  (D4). gap_id is re-anchored to the POSTed gap on every write; group_key is the
 *  recurrence key copied from the anchor's market-signal group (the generated
 *  group_key_hash dedupes on it). requirement_text/refs are posting-derived
 *  UNTRUSTED snapshot data. */
export interface DemoBlueprintSnapshot {
  gapId: string | null;
  groupKey: string;
  requirementText: string;
  title: string;
  scorerVersion: number;
  postingCount: number;
  instanceCount: number;
  mustHavePostingCount: number;
  niceToHavePostingCount: number;
  categories: RequirementCategory[];
  refs: MarketSignalRef[];
  problem: string;
  constraints: string;
  deliverables: string;
  evidenceRequired: string;
}

export interface DemoBlueprintsRepository {
  /** Insert one blueprint (group_key_hash is DB-generated). A second blueprint
   *  for the same (user, group_key) violates demo_blueprints_user_group_unique
   *  and throws 23505 - the service re-finds and falls through (raced create,
   *  the case_studies precedent). */
  insert(userId: string, snapshot: DemoBlueprintSnapshot): Promise<DemoBlueprintRow>;

  /** Full-replacement refresh in place: a conditional UPDATE pinned to
   *  (user, id) that re-anchors gap_id and re-snapshots every count/section/refs.
   *  undefined = missing / foreign (404). */
  updateSnapshotById(
    userId: string,
    id: string,
    snapshot: DemoBlueprintSnapshot,
  ): Promise<DemoBlueprintRow | undefined>;

  /** The existing blueprint for a (user, group_key) - the create/refresh dispatch
   *  key. group_key_hash is generated, so this matches on md5(group_key) in SQL.
   *  undefined when none. */
  findByGroupKey(userId: string, groupKey: string): Promise<DemoBlueprintRow | undefined>;

  /** One blueprint (owner-scoped) by row id, or undefined (404). Reachable for
   *  orphaned (gap-SET-NULL) rows, which a re-anchoring POST cannot reach by the
   *  old gap id. */
  findById(userId: string, id: string): Promise<DemoBlueprintRow | undefined>;

  /** All blueprints for the user, (created_at desc, id desc) order - the list
   *  picker (sections omitted at the wire, not here). */
  list(userId: string): Promise<DemoBlueprintRow[]>;

  /** Owner-scoped hard delete. Returns true iff a row was deleted (false = 404). */
  deleteById(userId: string, id: string): Promise<boolean>;
}

/** The snapshot columns shared by insert and updateSnapshotById (group_key_hash
 *  is DB-generated, never in this set). */
function snapshotValues(snapshot: DemoBlueprintSnapshot) {
  return {
    gapId: snapshot.gapId,
    groupKey: snapshot.groupKey,
    requirementText: snapshot.requirementText,
    title: snapshot.title,
    scorerVersion: snapshot.scorerVersion,
    postingCount: snapshot.postingCount,
    instanceCount: snapshot.instanceCount,
    mustHavePostingCount: snapshot.mustHavePostingCount,
    niceToHavePostingCount: snapshot.niceToHavePostingCount,
    categories: snapshot.categories,
    refs: snapshot.refs,
    problem: snapshot.problem,
    constraints: snapshot.constraints,
    deliverables: snapshot.deliverables,
    evidenceRequired: snapshot.evidenceRequired,
  };
}

export function createDemoBlueprintsRepository(db: Db): DemoBlueprintsRepository {
  return {
    async insert(userId, snapshot) {
      const [row] = await db
        .insert(demoBlueprints)
        .values({ userId, ...snapshotValues(snapshot) })
        .returning();
      if (!row) throw new Error('demo_blueprints insert returned no rows');
      return row;
    },

    async updateSnapshotById(userId, id, snapshot) {
      const [row] = await db
        .update(demoBlueprints)
        .set(snapshotValues(snapshot))
        .where(and(eq(demoBlueprints.userId, userId), eq(demoBlueprints.id, id)))
        .returning();
      return row;
    },

    async findByGroupKey(userId, groupKey) {
      const [row] = await db
        .select()
        .from(demoBlueprints)
        .where(
          and(
            eq(demoBlueprints.userId, userId),
            eq(demoBlueprints.groupKeyHash, sql`md5(${groupKey})`),
          ),
        )
        .limit(1);
      return row;
    },

    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(demoBlueprints)
        .where(and(eq(demoBlueprints.userId, userId), eq(demoBlueprints.id, id)))
        .limit(1);
      return row;
    },

    async list(userId) {
      return db
        .select()
        .from(demoBlueprints)
        .where(eq(demoBlueprints.userId, userId))
        .orderBy(desc(demoBlueprints.createdAt), desc(demoBlueprints.id));
    },

    async deleteById(userId, id) {
      const deleted = await db
        .delete(demoBlueprints)
        .where(and(eq(demoBlueprints.userId, userId), eq(demoBlueprints.id, id)))
        .returning({ id: demoBlueprints.id });
      return deleted.length > 0;
    },
  };
}

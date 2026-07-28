import {
  DEMO_BLUEPRINT_HONESTY,
  DEMO_BLUEPRINT_TITLE_MAX_CHARS,
  normalizeWhitespace,
  scaffoldDemoBlueprint,
  type CreateDemoBlueprintBody,
  type DemoBlueprint,
  type DemoBlueprintCreateResult,
  type DemoBlueprintListItem,
  type Exercise,
} from '@careerforge/core';
import {
  pgErrorCode,
  type DemoBlueprintRow,
  type DemoBlueprintsRepository,
  type DemoBlueprintSnapshot,
  type ExerciseDemoBlueprintRead,
  type ExerciseWithGaps,
  type GapsRepository,
} from '@careerforge/db';
import { aggregateMarketSignal } from '@careerforge/scoring';

// M9-04 (V2-PLAN 3.5): demo-blueprints service. DETERMINISTIC scaffolding over
// the live market signal - NO LLM (the M4-01 case-study class). Never-trust-the-
// client (D2): the POST body carries only an ANCHOR gapId; the server recomputes
// the FULL market signal, locates the gap's group, and re-derives Build
// eligibility itself. A doctored gapId can never mint a blueprint for a
// covered/other-bucket skill. Sections carry template constants + derived counts
// ONLY - the requirement text is snapshotted as its own separate field, never
// built into a section (D3). Value-free logs (ids + counts + a verdict code).

/** The gaps reads this module needs (read-only by type): the ownership 404 check
 *  and the market-signal recompute. */
type DemoBlueprintGapRead = Pick<GapsRepository, 'findGapsByIds' | 'listMarketSignalRows'>;

export class DemoBlueprintGapNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'GAP_NOT_FOUND';
  constructor() {
    // Id-free: the gap id is caller-supplied; missing or foreign is one 404.
    super('gap not found');
  }
}

export class DemoBlueprintGapNotInSignalError extends Error {
  readonly statusCode = 409;
  readonly code = 'GAP_NOT_IN_SIGNAL';
  constructor() {
    // The gap exists but is not in the current signal (its report was superseded
    // by a re-score, or its posting archived). Value-free.
    super('gap is not in the current market signal');
  }
}

export class DemoBlueprintNotBuildError extends Error {
  readonly statusCode = 409;
  readonly code = 'NOT_BUILD_RECOMMENDATION';
  constructor() {
    // The gap's group is real but sits in a non-Build bucket (sharpen/prove/
    // certify/noAction); demo blueprints scaffold Build recommendations only.
    super('gap is not a Build recommendation');
  }
}

export class DemoBlueprintNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('demo blueprint not found');
  }
}

export interface DemoBlueprintsService {
  /** POST /demo-blueprints - scaffold a new blueprint (201) or refresh the skill
   *  group's existing one in place (200), full-replacement. 404 gap, 409
   *  not-in-signal / not-Build. */
  create(userId: string, body: CreateDemoBlueprintBody): Promise<DemoBlueprintCreateResult>;
  /** GET /demo-blueprints - the list (sections + linkedExercises omitted). */
  list(userId: string): Promise<DemoBlueprintListItem[]>;
  /** GET /demo-blueprints/:id - one blueprint incl. sections + linkedExercises. */
  get(userId: string, id: string): Promise<DemoBlueprint>;
  /** DELETE /demo-blueprints/:id - owner-scoped hard delete. 404 unknown. */
  remove(userId: string, id: string): Promise<void>;
}

/** ExerciseWithGaps -> the exercise wire contract (the exercises-service mapper). */
function exerciseToWire(exercise: ExerciseWithGaps): Exercise {
  return {
    id: exercise.row.id,
    learningPlanId: exercise.row.learningPlanId,
    title: exercise.row.title,
    kind: exercise.row.kind,
    status: exercise.row.status,
    position: exercise.row.position,
    gapIds: exercise.gapIds,
    createdAt: exercise.row.createdAt.toISOString(),
  };
}

/** Row -> the list-item wire shape (sections/linkedExercises omitted). */
function toListItem(row: DemoBlueprintRow): DemoBlueprintListItem {
  return {
    id: row.id,
    title: row.title,
    requirementText: row.requirementText,
    postingCount: row.postingCount,
    mustHavePostingCount: row.mustHavePostingCount,
    scorerVersion: row.scorerVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDemoBlueprintsService(deps: {
  demoBlueprints: DemoBlueprintsRepository;
  gaps: DemoBlueprintGapRead;
  exercises: ExerciseDemoBlueprintRead;
}): DemoBlueprintsService {
  const { demoBlueprints, gaps, exercises } = deps;

  /** Row -> full wire, computing the read-only linkedExercises (D5): every
   *  exercise citing any of the snapshot's ref gaps. */
  async function toWire(userId: string, row: DemoBlueprintRow): Promise<DemoBlueprint> {
    const gapIds = [...new Set(row.refs.map((ref) => ref.gapId))];
    const linked = await exercises.listExercisesCitingGaps(userId, gapIds);
    return {
      id: row.id,
      gapId: row.gapId,
      groupKey: row.groupKey,
      title: row.title,
      requirementText: row.requirementText,
      scorerVersion: row.scorerVersion,
      postingCount: row.postingCount,
      instanceCount: row.instanceCount,
      mustHavePostingCount: row.mustHavePostingCount,
      niceToHavePostingCount: row.niceToHavePostingCount,
      categories: row.categories,
      refs: row.refs,
      sections: {
        problem: row.problem,
        constraints: row.constraints,
        deliverables: row.deliverables,
        evidenceRequired: row.evidenceRequired,
      },
      honesty: DEMO_BLUEPRINT_HONESTY,
      linkedExercises: linked.map(exerciseToWire),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return {
    async create(userId, body) {
      // 1. Ownership 404: an unknown/foreign gap id never reveals another user.
      const owned = await gaps.findGapsByIds(userId, [body.gapId]);
      if (owned.length === 0) throw new DemoBlueprintGapNotFoundError();

      // 2. Recompute the FULL market signal server-side (the M9-02 flow reused
      //    verbatim; zero client-supplied counts) and locate the gap's group.
      const rows = await gaps.listMarketSignalRows(userId);
      const result = aggregateMarketSignal(rows);
      const allGroups = [
        ...result.buckets.sharpen,
        ...result.buckets.prove,
        ...result.buckets.build,
        ...result.buckets.certify,
        ...result.noAction,
      ];
      const group = allGroups.find((candidate) =>
        candidate.refs.some((ref) => ref.gapId === body.gapId),
      );
      // 3. No group contains it (superseded report / archived posting) -> 409.
      if (!group) throw new DemoBlueprintGapNotInSignalError();
      // 4. Its group is not a Build recommendation -> 409 (re-derived, D2).
      if (!result.buckets.build.includes(group)) throw new DemoBlueprintNotBuildError();

      // 5. Scaffold + snapshot from the group's own COUNTS (no posting text into
      //    sections). Title defaults to the normalized requirement text, bounded.
      const sections = scaffoldDemoBlueprint({
        postingCount: group.postingCount,
        instanceCount: group.instanceCount,
        mustHavePostingCount: group.mustHavePostingCount,
        niceToHavePostingCount: group.niceToHavePostingCount,
        categories: group.categories,
      });
      const title =
        body.title ??
        normalizeWhitespace(group.displayText).slice(0, DEMO_BLUEPRINT_TITLE_MAX_CHARS);
      const snapshot: DemoBlueprintSnapshot = {
        gapId: body.gapId,
        groupKey: group.key,
        requirementText: group.displayText,
        title,
        scorerVersion: result.scorerVersion,
        postingCount: group.postingCount,
        instanceCount: group.instanceCount,
        mustHavePostingCount: group.mustHavePostingCount,
        niceToHavePostingCount: group.niceToHavePostingCount,
        categories: group.categories,
        refs: group.refs,
        ...sections,
      };

      // 6. Create-or-refresh on the (user, group_key) identity (M4-01 semantics).
      const existing = await demoBlueprints.findByGroupKey(userId, group.key);
      if (!existing) {
        try {
          const created = await demoBlueprints.insert(userId, snapshot);
          return { demoBlueprint: await toWire(userId, created), created: true };
        } catch (error) {
          // A concurrent create raced us to the unique index; fall through to
          // the refresh path on the now-present row.
          if (pgErrorCode(error) !== '23505') throw error;
        }
      }
      const current = existing ?? (await demoBlueprints.findByGroupKey(userId, group.key));
      const refreshed = current
        ? await demoBlueprints.updateSnapshotById(userId, current.id, snapshot)
        : undefined;
      if (!refreshed) {
        // The row was deleted between our read and the write (a rare race); a
        // fresh insert is the honest outcome.
        const reinserted = await demoBlueprints.insert(userId, snapshot);
        return { demoBlueprint: await toWire(userId, reinserted), created: true };
      }
      return { demoBlueprint: await toWire(userId, refreshed), created: false };
    },

    async list(userId) {
      const rows = await demoBlueprints.list(userId);
      return rows.map(toListItem);
    },

    async get(userId, id) {
      const row = await demoBlueprints.findById(userId, id);
      if (!row) throw new DemoBlueprintNotFoundError();
      return toWire(userId, row);
    },

    async remove(userId, id) {
      const deleted = await demoBlueprints.deleteById(userId, id);
      if (!deleted) throw new DemoBlueprintNotFoundError();
    },
  };
}

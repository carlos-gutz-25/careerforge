import {
  type EvidenceStrength,
  type GameplanCheckKey,
  type GameplanDraftingRunStatus,
  type GameplanPhase,
  GAMEPLAN_PHASES,
  type GapClassification,
  type PlanItemPriority,
  type PlanReviewStatus,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { evidenceLinks, fitReports, fitSubScores } from '../schema/fit.ts';
import {
  applicationGameplanRuns,
  applicationGameplans,
  gameplanChecks,
  gameplanPhaseStrategies,
  gameplanStories,
  gameplanStoryCitations,
} from '../schema/gameplan.ts';
import { gaps } from '../schema/gaps.ts';
import { interviewPreps } from '../schema/interview.ts';
import { applicationEvents, applications, jobPostings } from '../schema/jobs.ts';
import { improvementPlans, planItems } from '../schema/plans.ts';
import { type FitReportRow } from './fit-reports.repository.ts';

// M7-07 (ADR-0019 layer L3): application-gameplan persistence + reads over the
// six M7-05 tables (born unused there). A gameplan is an append-only artifact of
// exactly ONE fit report (pin-to-report; UNIQUE fit_report_id - the interview-prep
// pattern), reached through the POSTING (the service resolves the posting's LATEST
// report). The audit table records one row per WIRE CALL (the M1-05 law); the
// gameplan row + its phase-strategy / story / citation tree are created only from
// an ok, tripwire-clean run in the SAME transaction (flag-the-run-write-nothing).
// Every query is user-scoped (ADR-0007). SQL lives ONLY here - the service never
// touches drizzle.

export type GameplanRunRow = typeof applicationGameplanRuns.$inferSelect;
export type ApplicationGameplanRow = typeof applicationGameplans.$inferSelect;
export type GameplanPhaseStrategyRow = typeof gameplanPhaseStrategies.$inferSelect;
export type GameplanStoryRow = typeof gameplanStories.$inferSelect;
export type GameplanStoryCitationRow = typeof gameplanStoryCitations.$inferSelect;
export type GameplanCheckRow = typeof gameplanChecks.$inferSelect;

/** One wire call's audit row (the InterviewPrepRunInsert twin). The SERVICE maps
 *  packages/llm's LlmCallRecord into this shape. */
export interface GameplanRunInsert {
  promptId: string;
  provider: string;
  model: string;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  attempt: number;
  /** The runner's five states - 'flagged' is derived internally by
   *  persistDraftingOutcome through deriveGameplanRunStatus (message-likeness +
   *  story-citation tripwires, plus any external-pointer hit), never inserted
   *  from outside. The Exclude makes runner-set 'flagged' unrepresentable. */
  status: Exclude<GameplanDraftingRunStatus, 'flagged'>;
  /** LlmCallRecord.timestamp (the runner's now-seam clock, F3). */
  createdAt: Date;
}

/** One STAR story to persist. The service has already validated + resolved the
 *  citations to evidence-link ids (the transient requirementRef is DROPPED before
 *  this layer - gameplan_stories has no requirement column). Story and citation
 *  positions are assigned from array order. */
export interface GameplanStoryInsert {
  situation: string;
  task: string;
  action: string;
  result: string;
  citations: { evidenceLinkId: string }[];
}

/** The clean, tripwire-passed artifact to persist. `phaseStrategies` is a
 *  four-key record (the four-key object makes missing/extra keys unrepresentable
 *  at the type layer); the persist inserts EXACTLY one phase-strategy row per
 *  GAMEPLAN_PHASES member. */
export interface GameplanArtifactInsert {
  strategySummary: string;
  phaseStrategies: Record<GameplanPhase, string>;
  stories: GameplanStoryInsert[];
}

/** A verified-filter input row for the drafting payload: the report's
 *  extraction-run requirements each carrying its gap row on THIS report when one
 *  exists (LEFT JOIN - absent = no classification). quoteVerified stays tri-state
 *  here; the payload builder applies the strict === true filter. */
export interface GameplanRequirementRow {
  requirementId: string;
  quoteVerified: boolean | null;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  gapId: string | null;
  gapClassification: GapClassification | null;
}

/** Evidence rows for the drafting payload (requirement-keyed, with ids - the
 *  citation rows FK the cited link). Quotes are posting/profile-derived:
 *  untrusted payload data, never logged. */
export interface GameplanEvidenceRow {
  evidenceLinkId: string;
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** The report's reviewed improvement-plan items as gameplan guidance (action +
 *  priority only - never citable, no ids, no refs). Returned ONLY for a reviewed,
 *  non-empty plan; the SQL scopes review_status='reviewed' (the read half of the
 *  reviewed-only law). */
export interface GameplanImprovementPlanGuidance {
  items: { action: string; priority: PlanItemPriority }[];
}

/** One citation with its evidence-link display fields AND its owning
 *  requirement's fields (via evidence_links.requirement_id) joined per row. The
 *  service derives the story's requirement from these (all citations of a story
 *  share one requirement by tripwire construction; the service asserts agreement
 *  and throws on mixed rows). */
export interface GameplanStoryCitationWithDisplay {
  citation: GameplanStoryCitationRow;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
  requirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
}

export interface GameplanStoryWithCitations {
  story: GameplanStoryRow;
  /** Canonical (position, id) order. */
  citations: GameplanStoryCitationWithDisplay[];
}

export interface GameplanWithChildren {
  gameplan: ApplicationGameplanRow;
  /** The gameplan's OWN drafting run (via drafting_run_id - never latest-by-time
   *  when a gameplan exists). */
  run: GameplanRunRow;
  /** Read-sorted into GAMEPLAN_PHASES order. */
  phaseStrategies: GameplanPhaseStrategyRow[];
  /** Canonical (position, id) order. */
  stories: GameplanStoryWithCitations[];
}

export interface GameplanPersistOutcome {
  runs: GameplanRunRow[];
  /** true iff THIS persist created the gameplan row. */
  gameplanCreated: boolean;
  /** true iff the gameplan insert hit the UNIQUE (a concurrent draft won the
   *  race). The runs are still committed - both wire calls happened and both are
   *  recorded (the interview-prep ON CONFLICT DO NOTHING precedent). */
  conflicted: boolean;
}

/** markGameplanReviewed's three-way outcome (the markPrepReviewed mirror). */
export type GameplanReviewOutcome =
  | { kind: 'reviewed'; gameplan: ApplicationGameplanRow }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' };

/** A meta-only sibling pointer (id + review status only). */
export interface GameplanSiblingPointerRow {
  id: string;
  reviewStatus: PlanReviewStatus;
}

export interface GameplanSiblingPointers {
  improvementPlan: GameplanSiblingPointerRow | null;
  interviewPrep: GameplanSiblingPointerRow | null;
}

/** One stage_change event's raw detail + date (chronological). `detail` is
 *  parsed by the service via parseStageChangeDetail (one format, one home). */
export interface GameplanStageChangeRow {
  detail: string | null;
  occurredOn: string;
}

/**
 * The single policy site for the post-hoc 'flagged' status (the
 * deriveInterviewRunStatus twin): an ok run that failed EITHER M7-07 tripwire -
 * message-likeness (looksLikeOutreach fires on a drafted field, or any
 * containsExternalPointer hit) or story-citation provenance (a fabricated,
 * cross-requirement, or duplicate evidence ref) - is flagged AT INSERT TIME.
 * Non-ok statuses pass through untouched. The insert type's Exclude<...,'flagged'>
 * makes a runner-set 'flagged' unrepresentable.
 */
export function deriveGameplanRunStatus(
  status: Exclude<GameplanDraftingRunStatus, 'flagged'>,
  tripwireFailed: boolean,
): GameplanDraftingRunStatus {
  return status === 'ok' && tripwireFailed ? 'flagged' : status;
}

export interface ApplicationGameplansRepository {
  /** Posting existence probe (404 anchor); missing and foreign-owned are one
   *  outcome. Meta only - raw_text never leaves the row. */
  findPostingId(userId: string, postingId: string): Promise<string | undefined>;

  /** The posting's LATEST fit report by (created_at, id) - the pin-to-report
   *  anchor the posting-scoped routes resolve through. */
  findLatestReportForPosting(userId: string, postingId: string): Promise<FitReportRow | undefined>;

  /** The report's extraction-run requirements in (position, id) order, each
   *  LEFT-JOINed with its gap row on THIS report. Tri-state quoteVerified passes
   *  through - the payload builder filters. */
  findRequirementsForReport(userId: string, reportId: string): Promise<GameplanRequirementRow[]>;

  /** Evidence links of the report's sub-scores (requirement-keyed, with ids), for
   *  the drafting payload and the citation FKs. */
  findEvidenceForReport(userId: string, reportId: string): Promise<GameplanEvidenceRow[]>;

  /** The report's improvement-plan items as gameplan guidance, SQL-scoped to a
   *  reviewed plan; undefined when the plan is absent, draft, or empty. */
  findImprovementPlanGuidance(
    userId: string,
    fitReportId: string,
  ): Promise<GameplanImprovementPlanGuidance | undefined>;

  /**
   * ONE transaction for a whole drafting outcome (the persistDraftingOutcome
   * precedent): every wire-call audit row always; the gameplan row + its phase /
   * story / citation tree ONLY when `artifact` is provided - the caller's
   * contract is that `artifact` implies the final run is ok and tripwire-clean
   * (both directions). The final run's stored status passes through
   * deriveGameplanRunStatus (tripwireFailed=true => 'flagged', no gameplan row,
   * nothing reaches the DB). The gameplan insert is ON CONFLICT DO NOTHING on
   * fit_report_id: a lost concurrent race commits the runs and reports
   * `conflicted`. EXACTLY one phase-strategy row per GAMEPLAN_PHASES member;
   * story/citation position = array order.
   */
  persistDraftingOutcome(
    userId: string,
    fitReportId: string,
    runs: GameplanRunInsert[],
    tripwireFailed: boolean,
    artifact: GameplanArtifactInsert | undefined,
  ): Promise<GameplanPersistOutcome>;

  /** The report's gameplan with its drafting run, phase strategies (GAMEPLAN_PHASES
   *  order), and joined story/citation tree, or undefined when none exists. */
  findGameplanForReport(
    userId: string,
    fitReportId: string,
  ): Promise<GameplanWithChildren | undefined>;

  /** The gameplan by id (meta) - the review/checks routes' ownership probe. */
  findGameplanMeta(userId: string, gameplanId: string): Promise<ApplicationGameplanRow | undefined>;

  /** Latest drafting run for the report by (created_at, id) - the GET's
   *  failure-display read, used ONLY when no gameplan exists (R2). */
  findLatestRunForReport(userId: string, fitReportId: string): Promise<GameplanRunRow | undefined>;

  /** The one-shot draft->reviewed transition (the markPrepReviewed mirror):
   *  conditional UPDATE pinned to review_status='draft'; on zero rows a
   *  user-scoped re-read disambiguates already_reviewed from not_found. */
  markGameplanReviewed(
    userId: string,
    gameplanId: string,
    notes: string | null,
  ): Promise<GameplanReviewOutcome>;

  /** Race-safe checklist toggle: INSERT ... ON CONFLICT (gameplan, check_key) DO
   *  UPDATE SET done (no read-then-write). The caller has already 404-verified
   *  gameplan ownership; userId still rides the row (ADR-0007). */
  upsertCheck(
    userId: string,
    gameplanId: string,
    checkKey: GameplanCheckKey,
    done: boolean,
  ): Promise<GameplanCheckRow>;

  /** All toggle rows for a gameplan (the read overlay merges them with the code
   *  templates). */
  findChecksForGameplan(userId: string, gameplanId: string): Promise<GameplanCheckRow[]>;

  /** The posting's application stage_change events (chronological) - the timeline
   *  overlay's input. Empty when no application is tracked for the posting. */
  findStageChangeEventsForPosting(
    userId: string,
    postingId: string,
  ): Promise<GameplanStageChangeRow[]>;

  /** Meta-only pointers to the fit report's sibling artifacts (improvement plan,
   *  interview prep) - ids + review statuses only, never sibling content. */
  findSiblingPointers(userId: string, fitReportId: string): Promise<GameplanSiblingPointers>;
}

export function createApplicationGameplansRepository(db: Db): ApplicationGameplansRepository {
  return {
    async findPostingId(userId, postingId) {
      const [row] = await db
        .select({ id: jobPostings.id })
        .from(jobPostings)
        .where(and(eq(jobPostings.userId, userId), eq(jobPostings.id, postingId)))
        .limit(1);
      return row?.id;
    },

    async findLatestReportForPosting(userId, postingId) {
      const [report] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.postingId, postingId)))
        .orderBy(desc(fitReports.createdAt), desc(fitReports.id))
        .limit(1);
      return report;
    },

    async findRequirementsForReport(userId, reportId) {
      return db
        .select({
          requirementId: requirements.id,
          quoteVerified: requirements.quoteVerified,
          text: requirements.text,
          kind: requirements.kind,
          category: requirements.category,
          gapId: gaps.id,
          gapClassification: gaps.classification,
        })
        .from(requirements)
        .innerJoin(fitReports, eq(fitReports.extractionRunId, requirements.extractionRunId))
        .leftJoin(
          gaps,
          and(eq(gaps.fitReportId, fitReports.id), eq(gaps.requirementId, requirements.id)),
        )
        .where(and(eq(requirements.userId, userId), eq(fitReports.id, reportId)))
        .orderBy(asc(requirements.position), asc(requirements.id));
    },

    async findEvidenceForReport(userId, reportId) {
      return db
        .select({
          evidenceLinkId: evidenceLinks.id,
          requirementId: evidenceLinks.requirementId,
          strength: evidenceLinks.strength,
          postingQuote: evidenceLinks.postingQuote,
          profileQuote: evidenceLinks.profileQuote,
        })
        .from(evidenceLinks)
        .innerJoin(fitSubScores, eq(fitSubScores.id, evidenceLinks.fitSubScoreId))
        .where(and(eq(evidenceLinks.userId, userId), eq(fitSubScores.fitReportId, reportId)))
        .orderBy(asc(evidenceLinks.createdAt), asc(evidenceLinks.id));
    },

    async findImprovementPlanGuidance(userId, fitReportId) {
      const rows = await db
        .select({ action: planItems.action, priority: planItems.priority })
        .from(planItems)
        .innerJoin(improvementPlans, eq(improvementPlans.id, planItems.improvementPlanId))
        .where(
          and(
            eq(improvementPlans.userId, userId),
            eq(improvementPlans.fitReportId, fitReportId),
            eq(improvementPlans.reviewStatus, 'reviewed'),
          ),
        )
        .orderBy(asc(planItems.position), asc(planItems.id));
      return rows.length > 0 ? { items: rows } : undefined;
    },

    async persistDraftingOutcome(userId, fitReportId, runs, tripwireFailed, artifact) {
      if (runs.length === 0) throw new Error('persistDraftingOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: GameplanRunRow[] = [];
        for (const [index, run] of runs.entries()) {
          const [runRow] = await tx
            .insert(applicationGameplanRuns)
            .values({
              userId,
              fitReportId,
              promptId: run.promptId,
              provider: run.provider,
              model: run.model,
              rawResponse: run.rawResponse,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              cacheReadInputTokens: run.cacheReadInputTokens,
              cacheCreationInputTokens: run.cacheCreationInputTokens,
              latencyMs: run.latencyMs,
              attempt: run.attempt,
              status:
                index === finalIndex
                  ? deriveGameplanRunStatus(run.status, tripwireFailed)
                  : run.status,
              createdAt: run.createdAt,
            })
            .returning();
          if (!runRow) throw new Error('application_gameplan_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        let gameplanCreated = false;
        let conflicted = false;
        if (artifact !== undefined) {
          if (finalRun.status !== 'ok') {
            throw new Error('gameplan artifact requires an ok, tripwire-clean final run');
          }
          const [gameplanRow] = await tx
            .insert(applicationGameplans)
            .values({
              userId,
              fitReportId,
              draftingRunId: finalRun.id,
              strategySummary: artifact.strategySummary,
            })
            .onConflictDoNothing({ target: applicationGameplans.fitReportId })
            .returning();
          if (gameplanRow) {
            gameplanCreated = true;
            // EXACTLY one phase-strategy row per phase, in canonical
            // GAMEPLAN_PHASES order (the four-key record makes missing/extra keys
            // unrepresentable at the type layer; the DB UNIQUE (gameplan, phase)
            // is the second belt).
            await tx.insert(gameplanPhaseStrategies).values(
              GAMEPLAN_PHASES.map((phase) => ({
                userId,
                applicationGameplanId: gameplanRow.id,
                phase,
                strategy: artifact.phaseStrategies[phase],
              })),
            );
            for (const [position, story] of artifact.stories.entries()) {
              const [storyRow] = await tx
                .insert(gameplanStories)
                .values({
                  userId,
                  applicationGameplanId: gameplanRow.id,
                  situation: story.situation,
                  task: story.task,
                  action: story.action,
                  result: story.result,
                  position,
                })
                .returning();
              if (!storyRow) throw new Error('gameplan_stories insert returned no rows');
              if (story.citations.length > 0) {
                await tx.insert(gameplanStoryCitations).values(
                  story.citations.map((citation, citationPosition) => ({
                    userId,
                    gameplanStoryId: storyRow.id,
                    evidenceLinkId: citation.evidenceLinkId,
                    position: citationPosition,
                  })),
                );
              }
            }
          } else {
            conflicted = true;
          }
        }

        return { runs: runRows, gameplanCreated, conflicted };
      });
    },

    async findGameplanForReport(userId, fitReportId) {
      const [gameplanRow] = await db
        .select()
        .from(applicationGameplans)
        .where(
          and(
            eq(applicationGameplans.userId, userId),
            eq(applicationGameplans.fitReportId, fitReportId),
          ),
        )
        .limit(1);
      if (!gameplanRow) return undefined;

      const [runRow] = await db
        .select()
        .from(applicationGameplanRuns)
        .where(eq(applicationGameplanRuns.id, gameplanRow.draftingRunId))
        .limit(1);
      if (!runRow) throw new Error('application gameplan has no drafting run (FK violated?)');

      const phaseRows = await db
        .select()
        .from(gameplanPhaseStrategies)
        .where(eq(gameplanPhaseStrategies.applicationGameplanId, gameplanRow.id));
      // Read order = the fixed GAMEPLAN_PHASES order (a phase enum has a canonical
      // order; no position column exists). Sorted in memory - the four-row set is
      // tiny and a SQL CASE would duplicate the code truth.
      const phaseStrategies = [...phaseRows].sort(
        (a, b) => GAMEPLAN_PHASES.indexOf(a.phase) - GAMEPLAN_PHASES.indexOf(b.phase),
      );

      const storyRows = await db
        .select()
        .from(gameplanStories)
        .where(eq(gameplanStories.applicationGameplanId, gameplanRow.id))
        .orderBy(asc(gameplanStories.position), asc(gameplanStories.id));

      const storyIds = storyRows.map((row) => row.id);
      const citationRows =
        storyIds.length === 0
          ? []
          : await db
              .select({
                citation: gameplanStoryCitations,
                strength: evidenceLinks.strength,
                postingQuote: evidenceLinks.postingQuote,
                profileQuote: evidenceLinks.profileQuote,
                requirementId: requirements.id,
                requirementText: requirements.text,
                requirementKind: requirements.kind,
                requirementCategory: requirements.category,
              })
              .from(gameplanStoryCitations)
              .innerJoin(evidenceLinks, eq(evidenceLinks.id, gameplanStoryCitations.evidenceLinkId))
              .innerJoin(requirements, eq(requirements.id, evidenceLinks.requirementId))
              .where(inArray(gameplanStoryCitations.gameplanStoryId, storyIds))
              .orderBy(asc(gameplanStoryCitations.position), asc(gameplanStoryCitations.id));

      const citationsByStory = new Map<string, GameplanStoryCitationWithDisplay[]>();
      for (const row of citationRows) {
        const list = citationsByStory.get(row.citation.gameplanStoryId);
        if (list) list.push(row);
        else citationsByStory.set(row.citation.gameplanStoryId, [row]);
      }

      return {
        gameplan: gameplanRow,
        run: runRow,
        phaseStrategies,
        stories: storyRows.map((story) => ({
          story,
          citations: citationsByStory.get(story.id) ?? [],
        })),
      };
    },

    async findGameplanMeta(userId, gameplanId) {
      const [row] = await db
        .select()
        .from(applicationGameplans)
        .where(
          and(eq(applicationGameplans.userId, userId), eq(applicationGameplans.id, gameplanId)),
        )
        .limit(1);
      return row;
    },

    async findLatestRunForReport(userId, fitReportId) {
      const [runRow] = await db
        .select()
        .from(applicationGameplanRuns)
        .where(
          and(
            eq(applicationGameplanRuns.userId, userId),
            eq(applicationGameplanRuns.fitReportId, fitReportId),
          ),
        )
        .orderBy(desc(applicationGameplanRuns.createdAt), desc(applicationGameplanRuns.id))
        .limit(1);
      return runRow;
    },

    async markGameplanReviewed(userId, gameplanId, notes) {
      const [updated] = await db
        .update(applicationGameplans)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(applicationGameplans.userId, userId),
            eq(applicationGameplans.id, gameplanId),
            eq(applicationGameplans.reviewStatus, 'draft'),
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', gameplan: updated };

      const [existing] = await db
        .select({ id: applicationGameplans.id })
        .from(applicationGameplans)
        .where(
          and(eq(applicationGameplans.userId, userId), eq(applicationGameplans.id, gameplanId)),
        )
        .limit(1);
      return existing ? { kind: 'already_reviewed' } : { kind: 'not_found' };
    },

    async upsertCheck(userId, gameplanId, checkKey, done) {
      const [row] = await db
        .insert(gameplanChecks)
        .values({ userId, applicationGameplanId: gameplanId, checkKey, done })
        .onConflictDoUpdate({
          target: [gameplanChecks.applicationGameplanId, gameplanChecks.checkKey],
          set: { done },
        })
        .returning();
      if (!row) throw new Error('gameplan_checks upsert returned no rows');
      return row;
    },

    async findChecksForGameplan(userId, gameplanId) {
      return db
        .select()
        .from(gameplanChecks)
        .where(
          and(
            eq(gameplanChecks.userId, userId),
            eq(gameplanChecks.applicationGameplanId, gameplanId),
          ),
        );
    },

    async findStageChangeEventsForPosting(userId, postingId) {
      return db
        .select({
          detail: applicationEvents.detail,
          occurredOn: applicationEvents.occurredOn,
        })
        .from(applicationEvents)
        .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
        .where(
          and(
            eq(applicationEvents.userId, userId),
            eq(applications.postingId, postingId),
            eq(applicationEvents.kind, 'stage_change'),
          ),
        )
        .orderBy(
          asc(applicationEvents.occurredOn),
          asc(applicationEvents.createdAt),
          asc(applicationEvents.id),
        );
    },

    async findSiblingPointers(userId, fitReportId) {
      const [improvementPlan] = await db
        .select({ id: improvementPlans.id, reviewStatus: improvementPlans.reviewStatus })
        .from(improvementPlans)
        .where(
          and(eq(improvementPlans.userId, userId), eq(improvementPlans.fitReportId, fitReportId)),
        )
        .limit(1);
      const [interviewPrep] = await db
        .select({ id: interviewPreps.id, reviewStatus: interviewPreps.reviewStatus })
        .from(interviewPreps)
        .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.fitReportId, fitReportId)))
        .limit(1);
      return {
        improvementPlan: improvementPlan ?? null,
        interviewPrep: interviewPrep ?? null,
      };
    },
  };
}

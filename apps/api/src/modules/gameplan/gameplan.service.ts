import {
  applicationStageSchema,
  GAMEPLAN_CHECKLIST_TEMPLATES,
  GAMEPLAN_PHASE_TO_APPLICATION_STAGE,
  GAMEPLAN_PHASES,
  containsExternalPointer,
  looksLikeOutreach,
  parseStageChangeDetail,
  type ApplicationGameplan,
  type ApplicationGameplanResponse,
  type ApplicationGameplanRun,
  type GameplanChecklistItem,
  type GameplanChecklistResponse,
  type GameplanPhase,
  type GameplanPhaseView,
  type GameplanReviewResponse,
  type GameplanStageEvent,
  type GameplanStoryWire,
} from '@careerforge/core';
import {
  type ApplicationGameplansRepository,
  type GameplanArtifactInsert,
  type GameplanCheckRow,
  type GameplanRunInsert,
  type GameplanRunRow,
  type GameplanWithChildren,
  type ProfileRepository,
} from '@careerforge/db';
import {
  applicationGameplanV1,
  buildGameplanPayload,
  runPrompt,
  type ApplicationGameplanOutput,
  type GameplanPayload,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';

import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// M7-07 (ADR-0019 layer L3): the gameplan service. The interview-prep draft()
// template applied to the gameplan, with its own two server tripwires
// (message-likeness + story-citation provenance) plus the reused no-URL law, the
// three read-time overlays (checklist / timeline / sibling pointers), the
// one-shot review CAS, and the checklist toggle. Routes -> service ->
// repository; SQL lives only in packages/db. Draft-until-reviewed (ADR-0005);
// everything LLM-drafted is UNTRUSTED on display (RISKS S-02).

export class PostingNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('posting not found');
  }
}

export class NoFitReportError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_FIT_REPORT';
  constructor() {
    super('the posting has no fit report yet');
  }
}

export class ReportNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORT_NOT_REVIEWED';
  constructor() {
    super('the latest fit report is not reviewed');
  }
}

export class NoVerifiedRequirementsError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_VERIFIED_REQUIREMENTS';
  constructor() {
    super('the report has no quote-verified requirements - nothing to draft from');
  }
}

export class GameplanNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('gameplan not found');
  }
}

export class GameplanAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'GAMEPLAN_ALREADY_REVIEWED';
  constructor() {
    super('the gameplan is already reviewed');
  }
}

export class LlmNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('no LLM provider is configured');
  }
}

export class LlmUpstreamError extends Error {
  readonly statusCode = 502;
  readonly code = 'LLM_UPSTREAM_ERROR';
  constructor(errorName: string, auditNote: string) {
    super(`LLM provider call failed: ${errorName}${auditNote}`);
  }
}

/** Value-free tripwire counts (the TripwireVerdict lineage) - these flow to the
 *  route log, never the verdict object, never any drafted text. */
export interface GameplanTripwireCounts {
  /** looksLikeOutreach hits over the prose set P (message-likeness, ADR-0019 L3). */
  messageLikenessHitCount: number;
  /** containsExternalPointer hits over the all-strings set S (the no-URL law,
   *  ADR-0017, reused not re-authored). */
  externalPointerHitCount: number;
  /** A story requirementRef or citationRef that was never sent. */
  fabricatedRefCount: number;
  /** A citation whose owning requirement differs from the story's requirement. */
  crossRequirementCiteCount: number;
  /** A citation ref repeated within one story. */
  duplicateCitationCount: number;
}

export interface GameplanTripwireVerdict extends GameplanTripwireCounts {
  failed: boolean;
  /** Defined IFF every check passed (one failure poisons the WHOLE output - no
   *  partial writes). undefined => the run lands 'flagged' and NOTHING is written. */
  artifact: GameplanArtifactInsert | undefined;
}

/**
 * The two server tripwires + the reused no-URL law, deterministic and evaluated
 * BEFORE any insert (D3). The zod schema already guarantees shape (cardinality,
 * ref patterns, field lengths, the four phase keys, stories <= 6) - the validator
 * NEVER re-checks shape (schema_failed is the retry path; tripwires are the flag
 * path; double-enforcing membership in zod would muddy the planted-FAIL proof).
 */
export function validateGameplanOutput(
  output: ApplicationGameplanOutput,
  payload: GameplanPayload,
): GameplanTripwireVerdict {
  // P = the PROSE set: summary + the four phase strategies + every story's STAR
  // fields. The message-likeness tripwire scans exactly this (it is policy, not
  // shape - no outreach refine exists in the output zod, deliberately).
  const prose = [
    output.strategySummary,
    output.phaseStrategies.apply,
    output.phaseStrategies.screen,
    output.phaseStrategies.interview,
    output.phaseStrategies.offer,
    ...output.stories.flatMap((story) => [story.situation, story.task, story.action, story.result]),
  ];
  let messageLikenessHitCount = 0;
  for (const text of prose) {
    if (looksLikeOutreach(text)) messageLikenessHitCount += 1;
  }

  // S = ALL strings: P plus every story's requirementRef and citationRefs (a
  // pointer inside a ref slot is a real anomaly - the widened-surface lineage).
  const allStrings = [
    ...prose,
    ...output.stories.flatMap((story) => [story.requirementRef, ...story.citationRefs]),
  ];
  let externalPointerHitCount = 0;
  for (const text of allStrings) {
    if (containsExternalPointer(text)) externalPointerHitCount += 1;
  }

  // Story-citation provenance: membership + ownership + within-story duplicates.
  let fabricatedRefCount = 0;
  let crossRequirementCiteCount = 0;
  let duplicateCitationCount = 0;
  const stories: GameplanArtifactInsert['stories'] = [];
  for (const story of output.stories) {
    const requirementId = payload.requirementIdByRef.get(story.requirementRef);
    if (requirementId === undefined) {
      fabricatedRefCount += 1;
      continue;
    }
    const seen = new Set<string>();
    const citations: { evidenceLinkId: string }[] = [];
    for (const ref of story.citationRefs) {
      if (seen.has(ref)) {
        duplicateCitationCount += 1;
        continue;
      }
      seen.add(ref);
      const resolved = payload.evidenceByRef.get(ref);
      if (resolved === undefined) {
        fabricatedRefCount += 1;
        continue;
      }
      if (resolved.requirementRef !== story.requirementRef) {
        crossRequirementCiteCount += 1;
        continue;
      }
      citations.push({ evidenceLinkId: resolved.evidenceLinkId });
    }
    // requirementRef is DROPPED here (gameplan_stories has no requirement column).
    stories.push({
      situation: story.situation,
      task: story.task,
      action: story.action,
      result: story.result,
      citations,
    });
  }

  const failed =
    messageLikenessHitCount +
      externalPointerHitCount +
      fabricatedRefCount +
      crossRequirementCiteCount +
      duplicateCitationCount >
    0;

  const artifact: GameplanArtifactInsert | undefined = failed
    ? undefined
    : {
        strategySummary: output.strategySummary,
        phaseStrategies: {
          apply: output.phaseStrategies.apply,
          screen: output.phaseStrategies.screen,
          interview: output.phaseStrategies.interview,
          offer: output.phaseStrategies.offer,
        },
        stories,
      };

  return {
    messageLikenessHitCount,
    externalPointerHitCount,
    fabricatedRefCount,
    crossRequirementCiteCount,
    duplicateCitationCount,
    failed,
    artifact,
  };
}

const ZERO_COUNTS: GameplanTripwireCounts = {
  messageLikenessHitCount: 0,
  externalPointerHitCount: 0,
  fabricatedRefCount: 0,
  crossRequirementCiteCount: 0,
  duplicateCitationCount: 0,
};

export interface GameplanDraftResult {
  response: ApplicationGameplanResponse;
  created: boolean;
  telemetry: GameplanTripwireCounts & {
    excludedRequirementCount: number;
    includedPlanItemCount: number;
  };
}

export interface GameplanService {
  draft(userId: string, postingId: string): Promise<GameplanDraftResult>;
  getGameplan(userId: string, postingId: string): Promise<ApplicationGameplanResponse>;
  review(
    userId: string,
    gameplanId: string,
    notes: string | null | undefined,
  ): Promise<GameplanReviewResponse>;
  toggleCheck(
    userId: string,
    gameplanId: string,
    checkKey: GameplanChecklistItem['key'],
    done: boolean,
  ): Promise<GameplanChecklistResponse>;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toInsert(record: LlmCallRecord): GameplanRunInsert {
  return {
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    rawResponse: stripNulChars(toPlainJson(record.rawResponse)),
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadInputTokens: record.usage.cacheReadInputTokens,
    cacheCreationInputTokens: record.usage.cacheCreationInputTokens,
    latencyMs: record.latencyMs,
    attempt: record.attempt,
    status: record.status,
    createdAt: new Date(record.timestamp),
  };
}

function toWireRun(row: GameplanRunRow): ApplicationGameplanRun {
  return {
    id: row.id,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attempt: row.attempt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

// stage -> phase, for the timeline overlay (the inverse of
// GAMEPLAN_PHASE_TO_APPLICATION_STAGE). Stages outside the mapping
// (considering/rejected/withdrawn) are deliberately absent (terminal display is
// the tracker's, not the gameplan's).
const PHASE_BY_STAGE = new Map<string, GameplanPhase>(
  GAMEPLAN_PHASES.map((phase) => [GAMEPLAN_PHASE_TO_APPLICATION_STAGE[phase], phase]),
);

export function createGameplanService(deps: {
  gameplans: ApplicationGameplansRepository;
  profile: ProfileRepository;
  provider: LlmProvider | undefined;
  now?: () => number;
}): GameplanService {
  const { gameplans, profile, provider } = deps;
  const prompt = applicationGameplanV1;

  function toChecklist(phase: GameplanPhase, checks: GameplanCheckRow[]): GameplanChecklistItem[] {
    const doneByKey = new Map(checks.map((row) => [row.checkKey, row.done]));
    return GAMEPLAN_CHECKLIST_TEMPLATES.filter((template) => template.phase === phase).map(
      (template) => ({
        key: template.key,
        phase: template.phase,
        label: template.label,
        done: doneByKey.get(template.key) ?? false,
      }),
    );
  }

  function toStageEventsByPhase(
    rows: { detail: string | null; occurredOn: string }[],
  ): Map<GameplanPhase, GameplanStageEvent[]> {
    const byPhase = new Map<GameplanPhase, GameplanStageEvent[]>();
    for (const row of rows) {
      if (row.detail === null) continue;
      const parsed = parseStageChangeDetail(row.detail);
      if (!parsed) continue;
      // Each side is validated per the parseStageChangeDetail caller contract;
      // keep the event only if both parse (malformed/foreign details are SKIPPED).
      const from = applicationStageSchema.safeParse(parsed.from);
      const to = applicationStageSchema.safeParse(parsed.to);
      if (!from.success || !to.success) continue;
      const phase = PHASE_BY_STAGE.get(to.data);
      if (phase === undefined) continue; // TO stage outside the active-pursuit view.
      const list = byPhase.get(phase) ?? [];
      list.push({ occurredOn: row.occurredOn, fromStage: from.data, toStage: to.data });
      byPhase.set(phase, list);
    }
    return byPhase;
  }

  function toStory(stored: GameplanWithChildren['stories'][number]): GameplanStoryWire {
    // Derive the story's requirement from its citations (all share one requirement
    // by tripwire construction; assert agreement and throw on mixed rows - loud,
    // not silent, R6).
    const first = stored.citations[0];
    if (first === undefined) throw new Error('gameplan story has no citations');
    for (const citation of stored.citations) {
      if (citation.requirementId !== first.requirementId) {
        throw new Error('gameplan story citations span multiple requirements');
      }
    }
    return {
      id: stored.story.id,
      position: stored.story.position,
      situation: stored.story.situation,
      task: stored.story.task,
      action: stored.story.action,
      result: stored.story.result,
      requirementId: first.requirementId,
      requirementText: first.requirementText,
      requirementKind: first.requirementKind,
      requirementCategory: first.requirementCategory,
      citations: stored.citations.map((citation) => ({
        evidenceLinkId: citation.citation.evidenceLinkId,
        strength: citation.strength,
        postingQuote: citation.postingQuote,
        profileQuote: citation.profileQuote,
      })),
    };
  }

  async function toWireGameplan(
    userId: string,
    postingId: string,
    stored: GameplanWithChildren,
  ): Promise<ApplicationGameplan> {
    const [checks, stageRows, siblings] = await Promise.all([
      gameplans.findChecksForGameplan(userId, stored.gameplan.id),
      gameplans.findStageChangeEventsForPosting(userId, postingId),
      gameplans.findSiblingPointers(userId, stored.gameplan.fitReportId),
    ]);
    const eventsByPhase = toStageEventsByPhase(stageRows);
    const strategyByPhase = new Map(stored.phaseStrategies.map((row) => [row.phase, row.strategy]));

    const phases: GameplanPhaseView[] = GAMEPLAN_PHASES.map((phase) => {
      const strategy = strategyByPhase.get(phase);
      if (strategy === undefined) throw new Error('gameplan missing a phase strategy row');
      return {
        phase,
        strategy,
        checklist: toChecklist(phase, checks),
        stageEvents: eventsByPhase.get(phase) ?? [],
      };
    });

    return {
      id: stored.gameplan.id,
      fitReportId: stored.gameplan.fitReportId,
      reviewStatus: stored.gameplan.reviewStatus,
      notes: stored.gameplan.notes,
      createdAt: stored.gameplan.createdAt.toISOString(),
      strategySummary: stored.gameplan.strategySummary,
      phases,
      stories: stored.stories.map(toStory),
      siblings: {
        improvementPlan: siblings.improvementPlan,
        interviewPrep: siblings.interviewPrep,
      },
    };
  }

  return {
    async draft(userId, postingId) {
      const posting = await gameplans.findPostingId(userId, postingId);
      // Missing and foreign-owned are the same 404 (user-scoped read).
      if (!posting) throw new PostingNotFoundError();
      const report = await gameplans.findLatestReportForPosting(userId, postingId);
      if (!report) throw new NoFitReportError();
      // The LATEST report must itself be reviewed (never an older reviewed one).
      if (report.reviewStatus !== 'reviewed') throw new ReportNotReviewedError();

      // UNIQUE-as-cache (ADR-0019 consequence B): an existing gameplan is served
      // with no LLM call; regeneration = re-score (a new report).
      const existing = await gameplans.findGameplanForReport(userId, report.id);
      if (existing) {
        return {
          response: {
            run: toWireRun(existing.run),
            gameplan: await toWireGameplan(userId, postingId, existing),
            cached: true,
          },
          created: false,
          telemetry: { ...ZERO_COUNTS, excludedRequirementCount: 0, includedPlanItemCount: 0 },
        };
      }

      const requirementRows = await gameplans.findRequirementsForReport(userId, report.id);
      const evidenceRows = await gameplans.findEvidenceForReport(userId, report.id);
      const guidance = await gameplans.findImprovementPlanGuidance(userId, report.id);
      const profileData = await profile.getProfile(userId);
      const built = buildGameplanPayload(
        profileData.skills.map((skill) => ({ name: skill.name, level: skill.level })),
        requirementRows.map((row) => ({
          requirementId: row.requirementId,
          quoteVerified: row.quoteVerified,
          text: row.text,
          kind: row.kind,
          category: row.category,
          gap:
            row.gapId !== null && row.gapClassification !== null
              ? { gapId: row.gapId, classification: row.gapClassification }
              : null,
        })),
        evidenceRows,
        guidance ? { reviewStatus: 'reviewed', items: guidance.items } : null,
      );
      // Nothing verified to draft from -> 409 BEFORE any paid call.
      if (built.verifiedRequirementCount === 0) throw new NoVerifiedRequirementsError();

      if (!provider) throw new LlmNotConfiguredError();

      // The collecting sink: an array push cannot throw, so every record reaches
      // the audit table even on the error path.
      const records: LlmCallRecord[] = [];
      let result;
      try {
        result = await runPrompt(
          prompt,
          { untrustedData: built.payload },
          {
            provider,
            recordCall: (record) => {
              records.push(record);
            },
            ...(deps.now ? { now: deps.now } : {}),
          },
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'unknown';
        let auditNote = '';
        try {
          await gameplans.persistDraftingOutcome(
            userId,
            report.id,
            records.map(toInsert),
            false,
            undefined,
          );
        } catch {
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      let verdict: GameplanTripwireVerdict | undefined;
      if (result.status === 'ok') {
        verdict = validateGameplanOutput(result.output, built);
      }
      const counts: GameplanTripwireCounts = verdict
        ? {
            messageLikenessHitCount: verdict.messageLikenessHitCount,
            externalPointerHitCount: verdict.externalPointerHitCount,
            fabricatedRefCount: verdict.fabricatedRefCount,
            crossRequirementCiteCount: verdict.crossRequirementCiteCount,
            duplicateCitationCount: verdict.duplicateCitationCount,
          }
        : ZERO_COUNTS;

      const outcome = await gameplans.persistDraftingOutcome(
        userId,
        report.id,
        records.map(toInsert),
        verdict?.failed ?? false,
        verdict?.artifact,
      );
      const telemetry = {
        ...counts,
        excludedRequirementCount: built.excludedRequirementCount,
        includedPlanItemCount: built.includedPlanItemCount,
      };

      if (outcome.conflicted) {
        const winner = await gameplans.findGameplanForReport(userId, report.id);
        if (!winner) throw new Error('conflicted persist but no gameplan found');
        return {
          response: {
            run: toWireRun(winner.run),
            gameplan: await toWireGameplan(userId, postingId, winner),
            cached: true,
          },
          created: false,
          telemetry,
        };
      }

      if (outcome.gameplanCreated) {
        const stored = await gameplans.findGameplanForReport(userId, report.id);
        if (!stored) throw new Error('gameplan persisted but not readable');
        return {
          response: {
            run: toWireRun(stored.run),
            gameplan: await toWireGameplan(userId, postingId, stored),
            cached: false,
          },
          created: true,
          telemetry,
        };
      }

      // A non-ok / flagged terminal: the run(s) recorded, no gameplan.
      const finalRun = outcome.runs[outcome.runs.length - 1];
      if (!finalRun) throw new Error('drafting persisted no runs');
      return {
        response: { run: toWireRun(finalRun), gameplan: null, cached: false },
        created: true,
        telemetry,
      };
    },

    async getGameplan(userId, postingId) {
      const posting = await gameplans.findPostingId(userId, postingId);
      if (!posting) throw new PostingNotFoundError();
      const report = await gameplans.findLatestReportForPosting(userId, postingId);
      // No report at all: an empty collection, not a 404 (a GET carries no
      // preconditions).
      if (!report) return { run: null, gameplan: null, cached: false };

      const stored = await gameplans.findGameplanForReport(userId, report.id);
      if (stored) {
        return {
          run: toWireRun(stored.run),
          gameplan: await toWireGameplan(userId, postingId, stored),
          cached: false,
        };
      }
      // Failure display: latest-by-time run ONLY when no gameplan exists (R2).
      const latest = await gameplans.findLatestRunForReport(userId, report.id);
      return { run: latest ? toWireRun(latest) : null, gameplan: null, cached: false };
    },

    async review(userId, gameplanId, notes) {
      const outcome = await gameplans.markGameplanReviewed(
        userId,
        gameplanId,
        trimmedOrNull(notes),
      );
      if (outcome.kind === 'not_found') throw new GameplanNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new GameplanAlreadyReviewedError();
      return {
        id: outcome.gameplan.id,
        reviewStatus: outcome.gameplan.reviewStatus,
        notes: outcome.gameplan.notes,
      };
    },

    async toggleCheck(userId, gameplanId, checkKey, done) {
      // 404-verify ownership first (the checks route accepts only a closed enum +
      // boolean; the DB CHECK is the second belt). Allowed regardless of
      // reviewStatus (D6): the checklist is the user's own process state.
      const meta = await gameplans.findGameplanMeta(userId, gameplanId);
      if (!meta) throw new GameplanNotFoundError();
      await gameplans.upsertCheck(userId, gameplanId, checkKey, done);
      const checks = await gameplans.findChecksForGameplan(userId, gameplanId);
      // The FULL overlay (all templates, each with its done-state) so the UI never
      // computes state client-side.
      const checklist: GameplanChecklistItem[] = GAMEPLAN_PHASES.flatMap((phase) =>
        toChecklist(phase, checks),
      );
      return { checklist };
    },
  };
}

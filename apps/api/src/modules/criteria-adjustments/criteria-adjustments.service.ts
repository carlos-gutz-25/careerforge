import {
  applyCriteriaAdjustment,
  type ConfirmCriteriaAdjustmentBody,
  type ConfirmCriteriaAdjustmentResponse,
  type CriteriaAdjustmentRecord,
  type CriteriaAdjustmentTarget,
  type CriteriaResponse,
  type CriteriaSuggestionsResponse,
  type CriteriaSuggestionThresholds,
  type SearchCriteriaData,
} from '@careerforge/core';
import {
  type ApplicationsRepository,
  type CriteriaAdjustmentRow,
  type CriteriaAdjustmentsRepository,
  type ExtractionsRepository,
  type SearchCriteriaRepository,
  type SearchCriteriaRow,
} from '@careerforge/db';
import {
  MIN_COUNTER_PROGRESSED,
  MIN_MATCHED_CELL,
  MIN_RESOLVED_ANALYZABLE,
  MIN_UNMATCHED_CELL,
  suggestCriteriaAdjustments,
  type SuggestCriteriaAdjustmentsInput,
} from '@careerforge/scoring';

import { CriteriaNotFoundError, StaleCriteriaError } from '../criteria/criteria.service.ts';

// M4-02: Outcomes -> matching feedback. Deterministic suggest-and-confirm — NO
// LLM (the M3-06/M4-01 class). GET recomputes suggestions per request (nothing
// stored, nothing stale — the review-queue projection pattern). POST re-derives
// the FULL suggestion list SERVER-SIDE from current criteria + outcome state
// (zero client trust, the M3-06/M4-01 re-derivation lineage) before applying the
// removal via the ONE applyCriteriaAdjustment definition and the pinned CAS.
// Every cross-module read is a NARROW read-only view; the engine is pure.

export class CriteriaSuggestionNotDerivableError extends Error {
  readonly statusCode = 409;
  readonly code = 'SUGGESTION_NOT_DERIVABLE';
  constructor() {
    // The (kind, category, slug) triple does not yield a current suggestion:
    // criteria drift, new outcomes, a min(1) floor, or a fabricated key. Covers
    // all four with one value-free message (the UPGRADE_NOT_DERIVABLE analog).
    super('no criteria adjustment is derivable for this target');
  }
}

const THRESHOLDS: CriteriaSuggestionThresholds = {
  minResolvedAnalyzable: MIN_RESOLVED_ANALYZABLE,
  minMatchedCell: MIN_MATCHED_CELL,
  minUnmatchedCell: MIN_UNMATCHED_CELL,
  minCounterProgressed: MIN_COUNTER_PROGRESSED,
};

/** Row -> the 5-mechanism criteria document the engine + applier consume. */
function toCriteriaData(row: SearchCriteriaRow): SearchCriteriaData {
  return {
    hardFilters: row.hardFilters,
    positiveSignals: row.positiveSignals,
    negativeSignals: row.negativeSignals,
    forceLowestPriority: row.forceLowestPriority,
    compBounds: row.compBounds,
  };
}

/** Row -> the GET /criteria wire shape (updatedAt is the next confirm's pin). */
function toCriteriaResponse(row: SearchCriteriaRow): CriteriaResponse {
  return { ...toCriteriaData(row), updatedAt: row.updatedAt.toISOString() };
}

/** Audit row -> the wire record. criteria_before/after stay DB-only (never
 *  re-served); user_id never crosses the wire; createdAt becomes an ISO string. */
function toRecordWire(row: CriteriaAdjustmentRow): CriteriaAdjustmentRecord {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    slug: row.slug,
    evidence: row.evidence,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CriteriaAdjustmentsService {
  /** GET /criteria-suggestions — recomputed per request (200 always). */
  getSuggestions(userId: string): Promise<CriteriaSuggestionsResponse>;
  /** POST /criteria-adjustments — confirm a server-re-derived removal. */
  confirm(
    userId: string,
    body: ConfirmCriteriaAdjustmentBody,
  ): Promise<ConfirmCriteriaAdjustmentResponse>;
  /** GET /criteria-adjustments — the append-only audit list. */
  listAdjustments(userId: string): Promise<{ adjustments: CriteriaAdjustmentRecord[] }>;
}

export function createCriteriaAdjustmentsService(deps: {
  criteria: Pick<SearchCriteriaRepository, 'get'>;
  criteriaAdjustments: CriteriaAdjustmentsRepository;
  applications: Pick<ApplicationsRepository, 'listForUser' | 'listStageChangeEvents'>;
  extractions: Pick<ExtractionsRepository, 'listEligibleRequirementTexts'>;
}): CriteriaAdjustmentsService {
  const { criteria, criteriaAdjustments, applications, extractions } = deps;

  /** Assemble the pure engine's input: the user's applications with their stage
   *  trails and each posting's eligible requirements. No SQL here — repos only. */
  async function buildEngineInput(
    userId: string,
    criteriaData: SearchCriteriaData,
  ): Promise<SuggestCriteriaAdjustmentsInput> {
    const [apps, stageEvents] = await Promise.all([
      applications.listForUser(userId, {}),
      applications.listStageChangeEvents(userId),
    ]);
    const requirementsByPosting = await extractions.listEligibleRequirementTexts(
      userId,
      apps.map((app) => app.postingId),
    );
    const trailByApp = new Map<string, string[]>();
    for (const event of stageEvents) {
      if (event.detail === null) continue;
      const trail = trailByApp.get(event.applicationId) ?? [];
      trail.push(event.detail);
      trailByApp.set(event.applicationId, trail);
    }
    return {
      criteria: criteriaData,
      applications: apps.map((app) => ({
        applicationId: app.id,
        postingId: app.postingId,
        company: app.posting.company,
        title: app.posting.title,
        appliedOn: app.appliedOn,
        currentStage: app.stage,
        stageTrail: trailByApp.get(app.id) ?? [],
        // undefined (no requirement-bearing run) -> null; both read as "no
        // eligible requirements" and disclose under withoutRequirements.
        requirements: requirementsByPosting.get(app.postingId) ?? null,
      })),
    };
  }

  return {
    async getSuggestions(userId) {
      const row = await criteria.get(userId);
      if (!row) {
        // No criteria imported yet: nothing to analyze against. Honest empty
        // state — the UI shows insufficient-data with the thresholds.
        return {
          status: 'insufficient_data',
          criteriaUpdatedAt: null,
          totals: {
            applications: 0,
            exposed: 0,
            resolved: 0,
            analyzable: 0,
            inFlight: 0,
            withdrawnCensored: 0,
            withoutRequirements: 0,
          },
          thresholds: THRESHOLDS,
          suggestions: [],
        };
      }
      const input = await buildEngineInput(userId, toCriteriaData(row));
      const result = suggestCriteriaAdjustments(input);
      return {
        status: result.status,
        // Rides with the view so the confirm pin comes from the same read.
        criteriaUpdatedAt: row.updatedAt.toISOString(),
        totals: result.totals,
        thresholds: THRESHOLDS,
        suggestions: result.suggestions,
      };
    },

    async confirm(userId, body) {
      // 404-before-409 (the M3-04 order): criteria must exist to adjust.
      const row = await criteria.get(userId);
      if (!row) throw new CriteriaNotFoundError();
      const criteriaData = toCriteriaData(row);

      // RE-DERIVE the full list from CURRENT state (never trust the client that
      // the target is still a valid suggestion — the headline guard).
      const input = await buildEngineInput(userId, criteriaData);
      const { suggestions } = suggestCriteriaAdjustments(input);
      const target: CriteriaAdjustmentTarget = {
        kind: body.kind,
        category: body.category,
        slug: body.slug,
      };
      const suggestion = suggestions.find(
        (candidate) =>
          candidate.kind === target.kind &&
          candidate.category === target.category &&
          candidate.slug === target.slug,
      );
      if (!suggestion) throw new CriteriaSuggestionNotDerivableError();

      // Apply via the ONE definition; undefined = min(1) floor or slug gone.
      const after = applyCriteriaAdjustment(criteriaData, target);
      if (!after) throw new CriteriaSuggestionNotDerivableError();

      const result = await criteriaAdjustments.confirmAdjustment(
        userId,
        {
          kind: target.kind,
          category: target.category,
          slug: target.slug,
          evidence: suggestion.evidence,
          before: criteriaData,
          after,
        },
        new Date(body.expectedUpdatedAt),
      );
      // Same 409 as PUT /criteria's stale CAS — the criteria moved since the
      // caller's view; reload and retry with the current updatedAt.
      if (result.status === 'conflict') throw new StaleCriteriaError();
      return {
        adjustment: toRecordWire(result.adjustment),
        criteria: toCriteriaResponse(result.criteria),
      };
    },

    async listAdjustments(userId) {
      const rows = await criteriaAdjustments.listForUser(userId);
      return { adjustments: rows.map(toRecordWire) };
    },
  };
}

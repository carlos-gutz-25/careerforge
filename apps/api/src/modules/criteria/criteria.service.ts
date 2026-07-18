import { type CriteriaPutBody, type CriteriaResponse } from '@careerforge/core';
import { type SearchCriteriaRepository, type SearchCriteriaRow } from '@careerforge/db';

export class CriteriaNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'CRITERIA_NOT_FOUND';
  constructor() {
    // Deliberately value-free and id-free: 4xx messages pass through to the
    // response body in every env.
    super('no search criteria yet — import the profile or create via PUT /criteria');
  }
}

export class StaleCriteriaError extends Error {
  readonly statusCode = 409;
  readonly code = 'STALE_CRITERIA';
  constructor() {
    super('criteria changed concurrently — reload and retry with the current updatedAt');
  }
}

/** The response schema (packages/core) is what reaches the wire — the
 *  serializer strips row internals (id, user_id) by construction; updatedAt
 *  travels as the ISO string the next PUT pins its CAS to. */
function toWire(row: SearchCriteriaRow): CriteriaResponse {
  return {
    hardFilters: row.hardFilters,
    positiveSignals: row.positiveSignals,
    negativeSignals: row.negativeSignals,
    forceLowestPriority: row.forceLowestPriority,
    compBounds: row.compBounds,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CriteriaService {
  /** The user's criteria for GET /criteria; 404 until the first import/PUT. */
  getCriteria(userId: string): Promise<CriteriaResponse>;
  /**
   * PUT /criteria: full-document replace via the repository's pinned
   * compare-and-swap (expectedUpdatedAt null = create, ISO timestamp =
   * replace-if-unchanged). Any conflict — the row exists on create, changed
   * since the caller's read, or vanished — surfaces as the same 409, never a
   * blind overwrite (M1-02 conditional-update convention).
   */
  replaceCriteria(userId: string, body: CriteriaPutBody): Promise<CriteriaResponse>;
}

export function createCriteriaService(deps: {
  criteria: SearchCriteriaRepository;
}): CriteriaService {
  return {
    async getCriteria(userId) {
      const row = await deps.criteria.get(userId);
      if (!row) throw new CriteriaNotFoundError();
      return toWire(row);
    },

    async replaceCriteria(userId, body) {
      const { expectedUpdatedAt, ...data } = body;
      const row = await deps.criteria.replaceIfUnchanged(
        userId,
        data,
        expectedUpdatedAt === null ? null : new Date(expectedUpdatedAt),
      );
      if (!row) throw new StaleCriteriaError();
      return toWire(row);
    },
  };
}

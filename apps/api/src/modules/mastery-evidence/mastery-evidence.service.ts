import { type CreateMasteryEvidenceBody, type MasteryEvidence } from '@careerforge/core';
import {
  type ExerciseOwnershipRead,
  type MasteryEvidenceRepository,
  type MasteryEvidenceRow,
} from '@careerforge/db';

// M3-03: mastery evidence — deterministic user-authored CRUD (NO LLM). A record
// that an exercise (M3-02) was done. POST verifies the exercise is owned (404)
// before any write, defaults/validates the date, and inserts. DELETE enforces
// the AIRTIGHT delete-guard (D2): the last implemented/tested evidence of a
// `complete` exercise cannot be removed (409), so the completion gate is a true
// always-invariant. Cross-module reads are NARROW read-only views.

export class MasteryEvidenceExerciseNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Id-free: the exercise id is caller-supplied body input; missing or
    // foreign is one 404 outcome (the user-scoped read law).
    super('exercise not found');
  }
}

export class MasteryEvidenceFutureDateError extends Error {
  readonly statusCode = 400;
  readonly code = 'EVIDENCE_RECORDED_ON_IN_FUTURE';
  constructor() {
    // Evidence records what already happened — a future recordedOn is refused
    // (the honesty invariant). Value-free: the offending date is not echoed.
    super('recordedOn cannot be in the future');
  }
}

export class MasteryEvidenceNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('mastery evidence not found');
  }
}

export class EvidenceRequiredForCompletionError extends Error {
  readonly statusCode = 409;
  readonly code = 'EVIDENCE_REQUIRED_FOR_COMPLETION';
  constructor() {
    // The D2 airtight delete-guard: removing the LAST implemented/tested row of
    // a `complete` exercise would leave it complete-without-evidence.
    super('cannot delete the last implemented/tested evidence of a completed exercise');
  }
}

export interface MasteryEvidenceService {
  /** POST /mastery-evidence — record evidence under an owned exercise. */
  create(userId: string, body: CreateMasteryEvidenceBody): Promise<MasteryEvidence>;
  /** DELETE /mastery-evidence/:id — owner-scoped delete, guarded so it never
   *  breaks a completed exercise's evidence invariant (409). */
  remove(userId: string, evidenceId: string): Promise<void>;
}

/** Row → the mastery-evidence wire contract. `recordedOn` is already an ISO
 *  `YYYY-MM-DD` string (date column); `artifactUrl` is null when unset. */
function toWire(row: MasteryEvidenceRow): MasteryEvidence {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    kind: row.kind,
    artifactUrl: row.artifactUrl,
    recordedOn: row.recordedOn,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The server's LOCAL calendar date as `YYYY-MM-DD` — the clock the D7
 *  default/reject-future rules compare against (date-only, so a same-day
 *  near-midnight record is never spuriously rejected). */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createMasteryEvidenceService(deps: {
  evidence: MasteryEvidenceRepository;
  /** Narrow read-only exercises view — existence/ownership (404) + status for
   *  the D2 delete-guard. */
  exercises: ExerciseOwnershipRead;
  now?: () => number;
}): MasteryEvidenceService {
  const { evidence, exercises } = deps;
  const now = deps.now ?? (() => Date.now());

  return {
    async create(userId, body) {
      // Ownership precondition BEFORE any write (the exercise_id FK would else
      // 500 on a foreign id; a clean 404 is the contract).
      const exercise = await exercises.findExercise(userId, body.exerciseId);
      if (!exercise) throw new MasteryEvidenceExerciseNotFoundError();

      const today = toLocalDateString(new Date(now()));
      const recordedOn = body.recordedOn ?? today;
      // ISO YYYY-MM-DD sorts lexically == chronologically.
      if (recordedOn > today) throw new MasteryEvidenceFutureDateError();

      const created = await evidence.createEvidence(userId, {
        exerciseId: body.exerciseId,
        kind: body.kind,
        artifactUrl: body.artifactUrl ?? null,
        recordedOn,
      });
      return toWire(created);
    },

    async remove(userId, evidenceId) {
      const row = await evidence.findEvidence(userId, evidenceId);
      if (!row) throw new MasteryEvidenceNotFoundError();

      // D2 airtight delete-guard — only implemented/tested gate completion, and
      // only when the parent is `complete` and this is the last of that kind.
      if (row.kind === 'implemented' || row.kind === 'tested') {
        const exercise = await exercises.findExercise(userId, row.exerciseId);
        // The exercise always exists (evidence cascades with it); check defensively.
        if (exercise?.row.status === 'complete') {
          const counts = await evidence.countEvidenceByKind(userId, row.exerciseId);
          if (counts[row.kind] <= 1) throw new EvidenceRequiredForCompletionError();
        }
      }
      await evidence.deleteEvidence(userId, evidenceId);
    },
  };
}

import {
  renderCaseStudyDraftMarkdown,
  type CaseStudy,
  type CaseStudyListItem,
  type CreateCaseStudyBody,
} from '@careerforge/core';
import {
  pgErrorCode,
  type CaseStudiesRepository,
  type CaseStudyDraftInput,
  type CaseStudyRow,
  type ExerciseCaseStudyRead,
  type ExerciseWithGaps,
  type MasteryEvidenceEmbedRead,
} from '@careerforge/db';

// M4-01: Exercise -> case-study draft. DETERMINISTIC generate-and-refresh — NO
// LLM (the M3-06 class). POST re-derives EVERYTHING server-side from the
// exercise + evidence + gap-link state (zero client trust: the exercise's
// completion status is re-checked here, NEVER taken from the client — CONDITION
// #1). The rendered markdown is snapshotted at generate/refresh time and served
// byte-for-byte on export. Publishing (the CAS flip) is local bookkeeping;
// authoring portfolio content is a separate MANUAL step (the module wall).

export class CaseStudyExerciseNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'EXERCISE_NOT_FOUND';
  constructor() {
    // Id-free: the exercise id is caller-supplied; missing or foreign is one 404.
    super('exercise not found');
  }
}

export class CaseStudyExerciseNotCompleteError extends Error {
  readonly statusCode = 409;
  readonly code = 'EXERCISE_NOT_COMPLETE';
  constructor() {
    // A case study draws on a FINISHED exercise: only a `complete` exercise has
    // the completion date + guaranteed evidence a draft needs. Value-free.
    super('exercise is not complete');
  }
}

export class CaseStudyNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('case study not found');
  }
}

export class CaseStudyAlreadyPublishedError extends Error {
  readonly statusCode = 409;
  readonly code = 'CASE_STUDY_ALREADY_PUBLISHED';
  constructor() {
    // A published draft is locked: refresh and re-publish are rejected. The
    // recourse is DELETE + re-POST (OD-4). Value-free.
    super('case study is already published');
  }
}

/** POST result: the affected draft plus whether it was newly created (201) or
 *  refreshed in place (200). */
export interface CaseStudyCreateResult {
  caseStudy: CaseStudy;
  created: boolean;
}

export interface CaseStudiesService {
  /** POST /case-studies — generate a new draft (201) or refresh the exercise's
   *  existing draft (200), full-replacement. 404 exercise, 409 not-complete /
   *  already-published. */
  create(userId: string, body: CreateCaseStudyBody): Promise<CaseStudyCreateResult>;
  /** GET /case-studies — the list (markdown omitted; the list is a picker). */
  list(userId: string): Promise<CaseStudyListItem[]>;
  /** GET /case-studies/:id — one draft incl. markdown. 404 unknown. */
  get(userId: string, caseStudyId: string): Promise<CaseStudy>;
  /** GET /case-studies/:id/export — the stored markdown snapshot, byte-for-byte,
   *  with a filename. NO status gate (OD-5). 404 unknown. */
  export(userId: string, caseStudyId: string): Promise<{ filename: string; markdown: string }>;
  /** POST /case-studies/:id/publish — one-way CAS flip draft->published. 404
   *  unknown, 409 already published. */
  publish(userId: string, caseStudyId: string): Promise<CaseStudy>;
  /** DELETE /case-studies/:id — hard delete at any status (OD-4). 404 unknown. */
  remove(userId: string, caseStudyId: string): Promise<void>;
}

/** Repository row -> the list-item wire shape (markdown omitted). `user_id`
 *  never crosses the wire; timestamps become ISO strings. */
function toListItem(row: CaseStudyRow): CaseStudyListItem {
  return {
    id: row.id,
    title: row.title,
    provenance: row.provenance,
    status: row.status,
    exerciseId: row.exerciseId,
    exerciseTitle: row.exerciseTitle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Repository row -> the full wire contract (adds the rendered markdown body). */
function toWire(row: CaseStudyRow): CaseStudy {
  return { ...toListItem(row), renderedMarkdown: row.renderedMarkdown };
}

export function createCaseStudiesService(deps: {
  caseStudies: CaseStudiesRepository;
  exercises: ExerciseCaseStudyRead;
  masteryEvidence: MasteryEvidenceEmbedRead;
}): CaseStudiesService {
  const { caseStudies, exercises, masteryEvidence } = deps;

  /** Render the draft snapshot for an exercise (create OR refresh share this).
   *  Everything is re-derived server-side; the client supplies only the
   *  exercise id, an explicit provenance, and an optional title. */
  async function renderSnapshot(
    userId: string,
    exercise: ExerciseWithGaps,
    body: CreateCaseStudyBody,
  ): Promise<CaseStudyDraftInput> {
    // The caller has narrowed: `exercise` is defined and complete here.
    const { row, gapIds } = exercise;
    const evidenceByExercise = await masteryEvidence.listEvidenceByExerciseIds(userId, [row.id]);
    const evidence = evidenceByExercise.get(row.id) ?? [];
    const title = body.title ?? row.title;
    const renderedMarkdown = renderCaseStudyDraftMarkdown({
      title,
      provenance: body.provenance,
      exerciseTitle: row.title,
      exerciseKind: row.kind,
      // Non-null for a `complete` exercise (migration 0014 CHECK); the caller
      // has already gated on status === 'complete'.
      completedOn: row.completedOn as string,
      evidence: evidence.map((item) => ({
        kind: item.kind,
        artifactUrl: item.artifactUrl,
        recordedOn: item.recordedOn,
      })),
      linkedGapCount: gapIds.length,
    });
    return { title, provenance: body.provenance, exerciseTitle: row.title, renderedMarkdown };
  }

  return {
    async create(userId, body) {
      // 404 before 409 (the M3-04 order). Re-derive completion server-side —
      // NEVER trust the client that the exercise is finished (CONDITION #1).
      const exercise = await exercises.findExercise(userId, body.exerciseId);
      if (!exercise) throw new CaseStudyExerciseNotFoundError();
      if (exercise.row.status !== 'complete' || exercise.row.completedOn === null) {
        throw new CaseStudyExerciseNotCompleteError();
      }

      const snapshot = await renderSnapshot(userId, exercise, body);

      const existing = await caseStudies.findByExerciseId(userId, body.exerciseId);
      if (!existing) {
        try {
          const created = await caseStudies.createCaseStudy(userId, {
            exerciseId: body.exerciseId,
            ...snapshot,
          });
          return { caseStudy: toWire(created), created: true };
        } catch (error) {
          // A concurrent create raced us to the unique(exercise_id) index; fall
          // through to the refresh path on the now-present row.
          if (pgErrorCode(error) !== '23505') throw error;
        }
      }

      // Refresh path (the row existed, or a raced create just landed).
      const current = existing ?? (await caseStudies.findByExerciseId(userId, body.exerciseId));
      if (current && current.status === 'published') throw new CaseStudyAlreadyPublishedError();
      const refreshed = await caseStudies.refreshDraft(userId, current!.id, snapshot);
      // undefined = the draft was published between our read and the write (a
      // raced publish); the honest outcome is the same 409.
      if (!refreshed) throw new CaseStudyAlreadyPublishedError();
      return { caseStudy: toWire(refreshed), created: false };
    },

    async list(userId) {
      const rows = await caseStudies.listCaseStudies(userId);
      return rows.map(toListItem);
    },

    async get(userId, caseStudyId) {
      const row = await caseStudies.findCaseStudy(userId, caseStudyId);
      if (!row) throw new CaseStudyNotFoundError();
      return toWire(row);
    },

    async export(userId, caseStudyId) {
      const row = await caseStudies.findCaseStudy(userId, caseStudyId);
      if (!row) throw new CaseStudyNotFoundError();
      // NO status gate (OD-5): the DRAFT is the product here, feeding the manual
      // authoring step — the inverse of resume export's reviewed-only gate.
      return { filename: `case-study-${row.id}.md`, markdown: row.renderedMarkdown };
    },

    async publish(userId, caseStudyId) {
      const outcome = await caseStudies.publishCaseStudy(userId, caseStudyId);
      if (outcome === 'not_found') throw new CaseStudyNotFoundError();
      if (outcome === 'already_published') throw new CaseStudyAlreadyPublishedError();
      const row = await caseStudies.findCaseStudy(userId, caseStudyId);
      // Just published in the same request; the row is present.
      if (!row) throw new CaseStudyNotFoundError();
      return toWire(row);
    },

    async remove(userId, caseStudyId) {
      const deleted = await caseStudies.deleteCaseStudy(userId, caseStudyId);
      if (!deleted) throw new CaseStudyNotFoundError();
    },
  };
}

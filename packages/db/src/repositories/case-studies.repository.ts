import { type CaseStudyStatus, type ProjectProvenance } from '@careerforge/core';
import { and, asc, eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { caseStudies } from '../schema/case-studies.ts';

// M4-01: case-study draft persistence + reads. A case_study is a
// deterministically-generated draft from a completed exercise (M3-02) + its
// mastery evidence (M3-03) — plain CRUD, no LLM run table. The ONLY module
// allowed SQL for this table (routes -> services -> repositories). Every query
// is user-scoped (ADR-0007). No narrow Pick<> view is exported: nothing outside
// the case-studies service reads case studies.

export type CaseStudyRow = typeof caseStudies.$inferSelect;

/** The mutable snapshot the service renders for a create OR a refresh — the
 *  full-replacement payload (OD-1). `exerciseTitle` is snapshotted so the row
 *  survives a source-exercise delete (FK SET NULL). */
export interface CaseStudyDraftInput {
  title: string;
  provenance: ProjectProvenance;
  exerciseTitle: string;
  renderedMarkdown: string;
}

/** The create input = a draft snapshot bound to its source exercise. */
export interface CreateCaseStudyInput extends CaseStudyDraftInput {
  exerciseId: string;
}

/** Outcome of a publish attempt (maps to 200 / 409 / 404 in the service) — the
 *  revokeGrant idiom. */
export type PublishOutcome = 'published' | 'already_published' | 'not_found';

export interface CaseStudiesRepository {
  /** Insert one draft (status defaults to 'draft'). A second draft for the same
   *  exercise violates case_studies_exercise_unique and throws 23505 — the
   *  service re-finds and falls through (raced create). */
  createCaseStudy(userId: string, input: CreateCaseStudyInput): Promise<CaseStudyRow>;

  /** The existing draft/published row for an exercise, or undefined — the
   *  create/refresh dispatch key. */
  findByExerciseId(userId: string, exerciseId: string): Promise<CaseStudyRow | undefined>;

  /** One case study (owner-scoped) by row id, or undefined (404). Reachable for
   *  orphaned (exercise-deleted) rows, which POST cannot reach. */
  findCaseStudy(userId: string, caseStudyId: string): Promise<CaseStudyRow | undefined>;

  /** All case studies for the user, deterministically ordered (created_at, id).
   *  The list read (markdown omitted at the wire, not here). */
  listCaseStudies(userId: string): Promise<CaseStudyRow[]>;

  /** Race-safe full-replacement refresh: a conditional UPDATE pinned to
   *  (user, id, status='draft'). undefined = missing / foreign / raced-published
   *  (a concurrent publish flipped it out of draft between the service's read
   *  and this write). */
  refreshDraft(
    userId: string,
    caseStudyId: string,
    input: CaseStudyDraftInput,
  ): Promise<CaseStudyRow | undefined>;

  /** One-way CAS flip draft->published: a conditional UPDATE pinned to
   *  (user, id, status='draft'). 'published' on success; else 'already_published'
   *  (exists, not draft) or 'not_found' (the revokeGrant two-step). */
  publishCaseStudy(userId: string, caseStudyId: string): Promise<PublishOutcome>;

  /** Owner-scoped hard delete at ANY status (OD-4 — the mis-publish recourse).
   *  Returns true iff a row was deleted (false = 404). */
  deleteCaseStudy(userId: string, caseStudyId: string): Promise<boolean>;
}

export function createCaseStudiesRepository(db: Db): CaseStudiesRepository {
  return {
    async createCaseStudy(userId, input) {
      const [row] = await db
        .insert(caseStudies)
        .values({
          userId,
          exerciseId: input.exerciseId,
          exerciseTitle: input.exerciseTitle,
          title: input.title,
          provenance: input.provenance,
          renderedMarkdown: input.renderedMarkdown,
        })
        .returning();
      if (!row) throw new Error('case_studies insert returned no rows');
      return row;
    },

    async findByExerciseId(userId, exerciseId) {
      const [row] = await db
        .select()
        .from(caseStudies)
        .where(and(eq(caseStudies.userId, userId), eq(caseStudies.exerciseId, exerciseId)))
        .limit(1);
      return row;
    },

    async findCaseStudy(userId, caseStudyId) {
      const [row] = await db
        .select()
        .from(caseStudies)
        .where(and(eq(caseStudies.userId, userId), eq(caseStudies.id, caseStudyId)))
        .limit(1);
      return row;
    },

    async listCaseStudies(userId) {
      return db
        .select()
        .from(caseStudies)
        .where(eq(caseStudies.userId, userId))
        .orderBy(asc(caseStudies.createdAt), asc(caseStudies.id));
    },

    async refreshDraft(userId, caseStudyId, input) {
      const [row] = await db
        .update(caseStudies)
        .set({
          title: input.title,
          provenance: input.provenance,
          exerciseTitle: input.exerciseTitle,
          renderedMarkdown: input.renderedMarkdown,
        })
        .where(
          and(
            eq(caseStudies.userId, userId),
            eq(caseStudies.id, caseStudyId),
            eq(caseStudies.status, 'draft' satisfies CaseStudyStatus),
          ),
        )
        .returning();
      return row;
    },

    async publishCaseStudy(userId, caseStudyId) {
      const updated = await db
        .update(caseStudies)
        .set({ status: 'published' satisfies CaseStudyStatus })
        .where(
          and(
            eq(caseStudies.userId, userId),
            eq(caseStudies.id, caseStudyId),
            eq(caseStudies.status, 'draft' satisfies CaseStudyStatus),
          ),
        )
        .returning({ id: caseStudies.id });
      if (updated.length > 0) return 'published';
      // 0 rows: either the row does not exist (404) or it is not draft (409).
      const [exists] = await db
        .select({ id: caseStudies.id })
        .from(caseStudies)
        .where(and(eq(caseStudies.userId, userId), eq(caseStudies.id, caseStudyId)))
        .limit(1);
      return exists ? 'already_published' : 'not_found';
    },

    async deleteCaseStudy(userId, caseStudyId) {
      const deleted = await db
        .delete(caseStudies)
        .where(and(eq(caseStudies.userId, userId), eq(caseStudies.id, caseStudyId)))
        .returning({ id: caseStudies.id });
      return deleted.length > 0;
    },
  };
}

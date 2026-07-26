import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCaseStudiesRepository,
  type CreateCaseStudyInput,
} from './case-studies.repository.ts';
import { createExercisesRepository } from './exercises.repository.ts';
import { createUsersRepository } from './users.repository.ts';
import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';

// Integration tests for M4-01 case-study draft persistence (dockerized
// Postgres, migration 0016). The repository is plain CRUD — completion/wire
// checks live in the service. Fixtures use raw SQL for the plan/gap/exercise
// chain; all data fictional (RISKS P-01, Alex Rivera vocabulary).

const handle = createTestDb();
const { pool } = handle;
const users = createUsersRepository(handle.db);
const exercises = createExercisesRepository(handle.db);
const repo = createCaseStudiesRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const user = await users.create({
    email: `me.fictional.${String(seq)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  return user.id;
}

/** The plan/gap/exercise chain (mirrors the skill-upgrades fixture). Returns
 *  the plan id (for cascade tests) and the exercise id. */
async function seedExercise(userId: string): Promise<{ planId: string; exerciseId: string }> {
  seq += 1;
  const hash = String(seq).padEnd(64, 'e').slice(0, 64);
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting', $2) returning id`,
    [userId, hash],
  );
  const postingId = posting.rows[0]!.id;
  const run = await pool.query<{ id: string }>(
    `insert into extraction_runs
       (user_id, posting_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok')
     returning id`,
    [userId, postingId],
  );
  const runId = run.rows[0]!.id;
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, postingId, runId],
  );
  const req = await pool.query<{ id: string }>(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
     values ($1, $2, 'must_have', 'framework', 'Skill', 'Skill', 0.9, 0) returning id`,
    [userId, runId],
  );
  const gap = await pool.query<{ id: string }>(
    `insert into gaps
       (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
     values ($1, $2, $3, 'genuine_gap', 'genuine_gap', 'fictional') returning id`,
    [userId, report.rows[0]!.id, req.rows[0]!.id],
  );
  const lrun = await pool.query<{ id: string }>(
    `insert into learning_plan_runs
       (user_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, 'anthropic', 'claude', 'learning-plan@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok')
     returning id`,
    [userId],
  );
  const plan = await pool.query<{ id: string }>(
    `insert into learning_plans (user_id, title, drafting_run_id) values ($1, 'Fictional plan', $2) returning id`,
    [userId, lrun.rows[0]!.id],
  );
  const planId = plan.rows[0]!.id;
  await pool.query(
    `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
     values ($1, $2, $3, 'focus', 'high', 0)`,
    [userId, planId, gap.rows[0]!.id],
  );
  const exercise = await exercises.createExercise(userId, {
    learningPlanId: planId,
    title: 'Build a typed parser',
    kind: 'kata',
    gapIds: [gap.rows[0]!.id],
  });
  return { planId, exerciseId: exercise.row.id };
}

function draftInput(
  exerciseId: string,
  over: Partial<CreateCaseStudyInput> = {},
): CreateCaseStudyInput {
  return {
    exerciseId,
    title: 'Typed parser case study',
    provenance: 'personal',
    exerciseTitle: 'Build a typed parser',
    renderedMarkdown: '---\ntitle: "x"\n---\n\n## Problem\n\nbody\n',
    ...over,
  };
}

const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

describe('createCaseStudy + findByExerciseId', () => {
  it('inserts a draft and round-trips it by exercise id', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    expect(created.status).toBe('draft');
    expect(created.exerciseId).toBe(exerciseId);
    expect(created.title).toBe('Typed parser case study');

    const found = await repo.findByExerciseId(userId, exerciseId);
    expect(found?.id).toBe(created.id);
  });

  it('rejects a second draft for the same exercise (23505 unique index)', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    await repo.createCaseStudy(userId, draftInput(exerciseId));
    await expect(repo.createCaseStudy(userId, draftInput(exerciseId))).rejects.toSatisfy(
      rejectsWith('23505'),
    );
  });

  it('rejects a bad provenance / status via the CHECK constraint (23514)', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    await expect(
      pool.query(
        `insert into case_studies (user_id, exercise_id, exercise_title, title, provenance, status, rendered_markdown)
         values ($1, $2, 'x', 'x', 'bogus', 'draft', 'x')`,
        [userId, exerciseId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'));
    await expect(
      pool.query(
        `insert into case_studies (user_id, exercise_id, exercise_title, title, provenance, status, rendered_markdown)
         values ($1, $2, 'x', 'x', 'personal', 'archived', 'x')`,
        [userId, exerciseId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'));
  });

  it('scopes findByExerciseId to the owner', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const { exerciseId } = await seedExercise(owner);
    await repo.createCaseStudy(owner, draftInput(exerciseId));
    expect(await repo.findByExerciseId(other, exerciseId)).toBeUndefined();
  });
});

describe('listCaseStudies', () => {
  it('lists the user rows in (created_at, id) order and scopes by user', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const a = await seedExercise(owner);
    const b = await seedExercise(owner);
    const c = await seedExercise(other);
    const first = await repo.createCaseStudy(owner, draftInput(a.exerciseId, { title: 'A' }));
    const second = await repo.createCaseStudy(owner, draftInput(b.exerciseId, { title: 'B' }));
    await repo.createCaseStudy(other, draftInput(c.exerciseId, { title: 'C' }));

    const list = await repo.listCaseStudies(owner);
    expect(list.map((r) => r.id)).toEqual([first.id, second.id]);
    expect((await repo.listCaseStudies(other)).map((r) => r.title)).toEqual(['C']);
  });
});

describe('refreshDraft (full-replacement, race-safe)', () => {
  it('replaces title/provenance/exerciseTitle/markdown on a draft', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    const refreshed = await repo.refreshDraft(userId, created.id, {
      title: 'New title',
      provenance: 'personal_ai_assisted',
      exerciseTitle: 'Renamed exercise',
      renderedMarkdown: '---\ntitle: "y"\n---\n\n## Problem\n\nnew\n',
    });
    expect(refreshed?.title).toBe('New title');
    expect(refreshed?.provenance).toBe('personal_ai_assisted');
    expect(refreshed?.renderedMarkdown).toContain('new');
  });

  it('returns undefined after publish (a raced/locked draft)', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    expect(await repo.publishCaseStudy(userId, created.id)).toBe('published');
    expect(
      await repo.refreshDraft(userId, created.id, {
        title: 't',
        provenance: 'personal',
        exerciseTitle: 'e',
        renderedMarkdown: 'm',
      }),
    ).toBeUndefined();
  });
});

describe('publishCaseStudy (one-way CAS flip)', () => {
  it('flips draft->published once, then reports already_published', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    expect(await repo.publishCaseStudy(userId, created.id)).toBe('published');
    expect(await repo.publishCaseStudy(userId, created.id)).toBe('already_published');
    expect((await repo.findCaseStudy(userId, created.id))?.status).toBe('published');
  });

  it('reports not_found for an unknown id', async () => {
    const userId = await seedUser();
    expect(await repo.publishCaseStudy(userId, '11111111-1111-4111-8111-111111111111')).toBe(
      'not_found',
    );
  });
});

describe('deleteCaseStudy (any status, OD-4)', () => {
  it('deletes a draft and a published row; false when absent', async () => {
    const userId = await seedUser();
    const a = await seedExercise(userId);
    const b = await seedExercise(userId);
    const draft = await repo.createCaseStudy(userId, draftInput(a.exerciseId));
    const pub = await repo.createCaseStudy(userId, draftInput(b.exerciseId));
    await repo.publishCaseStudy(userId, pub.id);

    expect(await repo.deleteCaseStudy(userId, draft.id)).toBe(true);
    expect(await repo.deleteCaseStudy(userId, pub.id)).toBe(true);
    expect(await repo.deleteCaseStudy(userId, draft.id)).toBe(false);
  });

  it('after delete, a fresh draft for the same exercise re-creates (201 path)', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const first = await repo.createCaseStudy(userId, draftInput(exerciseId));
    await repo.publishCaseStudy(userId, first.id);
    await repo.deleteCaseStudy(userId, first.id);
    const second = await repo.createCaseStudy(userId, draftInput(exerciseId));
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('draft');
  });
});

describe('SET-NULL durability (navigation FK)', () => {
  it('survives a source-exercise delete with NULL exerciseId + intact snapshots', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    expect(await exercises.deleteExercise(userId, exerciseId)).toBe(true);

    const survivor = await repo.findCaseStudy(userId, created.id);
    expect(survivor?.exerciseId).toBeNull();
    expect(survivor?.exerciseTitle).toBe('Build a typed parser');
    expect(survivor?.renderedMarkdown).toBe(created.renderedMarkdown);
    // The orphaned row no longer blocks a NEW exercise's draft (NULLs distinct).
    const fresh = await seedExercise(userId);
    const another = await repo.createCaseStudy(userId, draftInput(fresh.exerciseId));
    expect(another.id).not.toBe(created.id);
  });

  it('survives a plan-cascade exercise delete (SET NULL, not cascade)', async () => {
    const userId = await seedUser();
    const { planId, exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    await pool.query(`delete from learning_plans where id = $1`, [planId]);
    const survivor = await repo.findCaseStudy(userId, created.id);
    expect(survivor?.exerciseId).toBeNull();
    expect(survivor?.title).toBe('Typed parser case study');
  });
});

describe('user-scoped cascade', () => {
  it('a user delete removes their case studies', async () => {
    const userId = await seedUser();
    const { exerciseId } = await seedExercise(userId);
    const created = await repo.createCaseStudy(userId, draftInput(exerciseId));
    await pool.query(`delete from users where id = $1`, [userId]);
    expect(await repo.findCaseStudy(userId, created.id)).toBeUndefined();
  });
});

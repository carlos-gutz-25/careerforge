import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { users } from './auth.ts';

// Verifies the DB enforces the ERD's rules by itself — raw SQL through the
// pool on purpose, so nothing from the Drizzle layer can mask a missing
// constraint. Fixture values are fictional (docs/profile.example/).
const handle = createTestDb();
const { pool, db } = handle;

async function insertUser(email = 'alex.rivera.example@example.com'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users (email, password_hash) values ($1, 'fake-hash') returning id`,
    [email],
  );
  return result.rows[0]!.id;
}

const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

beforeEach(() => truncateAllTables(handle));
afterAll(() => pool.end());

describe('schema v1 constraints (integration)', () => {
  it('CHECK rejects enum-like values outside the core value sets', async () => {
    const userId = await insertUser();
    await expect(
      pool.query(
        `insert into profile_skills (user_id, name, level) values ($1, 'Vue.js', 'ninja')`,
        [userId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation');
    // …and accepts documented values, applying column defaults.
    await pool.query(
      `insert into profile_skills (user_id, name, level) values ($1, 'Vue.js', 'expert')`,
      [userId],
    );
    const posting = await pool.query<{ status: string }>(
      `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting text', 'hash-1') returning status`,
      [userId],
    );
    expect(posting.rows[0]!.status).toBe('new');
  });

  it('search_criteria jsonb defaults are the declared structural placeholders (M1-08)', async () => {
    // Pins each column's ACTUAL declared default — negative_signals '[]',
    // the other four '{}' — per the declared posture: defaults are
    // structural placeholders, canonical validity lives at the write path.
    const userId = await insertUser();
    const { rows } = await pool.query<Record<string, unknown>>(
      `insert into search_criteria (user_id) values ($1)
       returning hard_filters, positive_signals, negative_signals,
                 force_lowest_priority, comp_bounds`,
      [userId],
    );
    expect(rows[0]).toEqual({
      hard_filters: {},
      positive_signals: {},
      negative_signals: [],
      force_lowest_priority: {},
      comp_bounds: {},
    });
  });

  it('UNIQUE(user_id, content_hash) dedupes pasted postings per user', async () => {
    const userId = await insertUser();
    const insert = () =>
      pool.query(
        `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting text', 'hash-dupe')`,
        [userId],
      );
    await insert();
    await expect(insert()).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation');
  });

  it('applications: one per posting, RESTRICT keeps applied-to postings undeletable', async () => {
    const userId = await insertUser();
    const posting = await pool.query<{ id: string }>(
      `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting text', 'hash-2') returning id`,
      [userId],
    );
    const postingId = posting.rows[0]!.id;
    const apply = () =>
      pool.query(`insert into applications (user_id, posting_id) values ($1, $2)`, [
        userId,
        postingId,
      ]);
    await apply();
    await expect(apply()).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation');
    // Archive-only postings: deleting one with an application is refused.
    await expect(
      pool.query(`delete from job_postings where id = $1`, [postingId]),
    ).rejects.toSatisfy(rejectsWith('23503'), 'expected foreign_key_violation (RESTRICT)');
  });

  it('deleting a user cascades to owned rows', async () => {
    const userId = await insertUser();
    await pool.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1, 'hash-x', now() + interval '1 hour')`,
      [userId],
    );
    await pool.query(
      `insert into profile_skills (user_id, name, level) values ($1, 'TypeScript', 'solid')`,
      [userId],
    );
    await pool.query(`delete from users where id = $1`, [userId]);
    const counts = await pool.query<{ sessions: string; skills: string }>(
      `select (select count(*) from sessions) as sessions, (select count(*) from profile_skills) as skills`,
    );
    expect(counts.rows[0]).toEqual({ sessions: '0', skills: '0' });
  });

  it('deleting an experience orphans its projects (SET NULL), not deletes them', async () => {
    const userId = await insertUser();
    const experience = await pool.query<{ id: string }>(
      `insert into profile_experiences (user_id, company, title, start_date) values ($1, 'Acme Analytics Co.', 'Senior Software Engineer', '2020-03-01') returning id`,
      [userId],
    );
    await pool.query(
      `insert into profile_projects (user_id, experience_id, name, provenance) values ($1, $2, 'Reporting Dashboard Modernization', 'professional')`,
      [userId, experience.rows[0]!.id],
    );
    await pool.query(`delete from profile_experiences where id = $1`, [experience.rows[0]!.id]);
    const project = await pool.query<{ experience_id: string | null }>(
      `select experience_id from profile_projects`,
    );
    expect(project.rows).toHaveLength(1);
    expect(project.rows[0]!.experience_id).toBeNull();
  });

  it('search_criteria is one row per user (unique user_id)', async () => {
    // Defaults are pinned by the M1-08 placeholder test above.
    const userId = await insertUser();
    const insert = () => pool.query(`insert into search_criteria (user_id) values ($1)`, [userId]);
    await insert();
    await expect(insert()).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation');
  });

  it('$onUpdate bumps updated_at on Drizzle updates', async () => {
    const userId = await insertUser();
    const [before] = await db.select().from(users).where(eq(users.id, userId));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await db
      .update(users)
      .set({ email: 'alex.updated.example@example.com' })
      .where(eq(users.id, userId));
    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after!.updatedAt.getTime()).not.toBe(before!.updatedAt.getTime());
    expect(after!.createdAt).toEqual(before!.createdAt);
  });
});

// --- M3-02: exercises + exercise_gaps -------------------------------------
// Builds the real fixture chain (posting -> run -> requirement -> fit_report
// -> gap; run -> learning_plan) with raw SQL so the DB — not Drizzle — is what
// enforces the ERD. All values fictional (docs/profile.example/).

async function seedPostingAndGap(
  userId: string,
  hash: string,
): Promise<{ postingId: string; gapId: string }> {
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting text', $2) returning id`,
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
  const requirement = await pool.query<{ id: string }>(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
     values ($1, $2, 'must_have', 'framework', 'Vue', 'Vue', 0.9, 0) returning id`,
    [userId, runId],
  );
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, postingId, runId],
  );
  const gap = await pool.query<{ id: string }>(
    `insert into gaps
       (user_id, fit_report_id, requirement_id, classification, engine_classification, rationale)
     values ($1, $2, $3, 'genuine_gap', 'genuine_gap', 'fictional rationale') returning id`,
    [userId, report.rows[0]!.id, requirement.rows[0]!.id],
  );
  return { postingId, gapId: gap.rows[0]!.id };
}

async function seedLearningPlan(userId: string): Promise<string> {
  const run = await pool.query<{ id: string }>(
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
    [userId, run.rows[0]!.id],
  );
  return plan.rows[0]!.id;
}

async function seedExercise(userId: string, planId: string, kind = 'kata'): Promise<string> {
  const exercise = await pool.query<{ id: string }>(
    `insert into exercises (user_id, learning_plan_id, title, kind, position) values ($1, $2, 'Fictional exercise', $3, 0) returning id`,
    [userId, planId, kind],
  );
  return exercise.rows[0]!.id;
}

describe('M3-02 exercises + exercise_gaps constraints (integration)', () => {
  it('exercises CHECK rejects invalid kind and status, and defaults status to planned', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    await expect(
      pool.query(
        `insert into exercises (user_id, learning_plan_id, title, kind, position) values ($1, $2, 'x', 'quiz', 0)`,
        [userId, planId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (kind)');
    await expect(
      pool.query(
        `insert into exercises (user_id, learning_plan_id, title, kind, status, position) values ($1, $2, 'x', 'kata', 'dropped', 0)`,
        [userId, planId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (status has no dropped)');
    const ok = await pool.query<{ status: string }>(
      `insert into exercises (user_id, learning_plan_id, title, kind, position) values ($1, $2, 'x', 'interview_drill', 0) returning status`,
      [userId, planId],
    );
    expect(ok.rows[0]!.status).toBe('planned');
  });

  it('UNIQUE(exercise_id, gap_id) forbids citing the same gap twice', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    const { gapId } = await seedPostingAndGap(userId, 'hash-uniq');
    const link = () =>
      pool.query(`insert into exercise_gaps (user_id, exercise_id, gap_id) values ($1, $2, $3)`, [
        userId,
        exerciseId,
        gapId,
      ]);
    await link();
    await expect(link()).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation');
  });

  it('deleting a learning plan cascades to its exercises and their gap links', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    const { gapId } = await seedPostingAndGap(userId, 'hash-plan-cascade');
    await pool.query(
      `insert into exercise_gaps (user_id, exercise_id, gap_id) values ($1, $2, $3)`,
      [userId, exerciseId, gapId],
    );
    await pool.query(`delete from learning_plans where id = $1`, [planId]);
    const counts = await pool.query<{ exercises: string; links: string }>(
      `select (select count(*) from exercises) as exercises, (select count(*) from exercise_gaps) as links`,
    );
    expect(counts.rows[0]).toEqual({ exercises: '0', links: '0' });
  });

  it('deleting an exercise (the mis-create recourse) cascades to its gap links only', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    const { gapId } = await seedPostingAndGap(userId, 'hash-ex-cascade');
    await pool.query(
      `insert into exercise_gaps (user_id, exercise_id, gap_id) values ($1, $2, $3)`,
      [userId, exerciseId, gapId],
    );
    await pool.query(`delete from exercises where id = $1`, [exerciseId]);
    const counts = await pool.query<{ links: string; gaps: string }>(
      `select (select count(*) from exercise_gaps) as links, (select count(*) from gaps) as gaps`,
    );
    // Links gone; the cited gap itself is untouched.
    expect(counts.rows[0]).toEqual({ links: '0', gaps: '1' });
  });

  it('deleting the posting cascades to the gap and its link, leaving the exercise (D6 partial-survival)', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    const { postingId, gapId } = await seedPostingAndGap(userId, 'hash-partial');
    await pool.query(
      `insert into exercise_gaps (user_id, exercise_id, gap_id) values ($1, $2, $3)`,
      [userId, exerciseId, gapId],
    );
    // A posting deletion removes its fit_report -> gap -> the citing link.
    await pool.query(`delete from job_postings where id = $1`, [postingId]);
    const counts = await pool.query<{ links: string; gaps: string; exercises: string }>(
      `select (select count(*) from exercise_gaps) as links,
              (select count(*) from gaps) as gaps,
              (select count(*) from exercises) as exercises`,
    );
    // The exercise persists link-less — no orphan, no dangling reference (D6).
    expect(counts.rows[0]).toEqual({ links: '0', gaps: '0', exercises: '1' });
  });
});

// --- M3-03: mastery_evidence ----------------------------------------------
// A user-authored record that an exercise was done. All values fictional
// (docs/profile.example/). The completion gate + airtight delete-guard are
// SERVICE preconditions (cross-table), NOT schema constraints — they are proven
// in the api route tests, not here; this block proves only what the DB owns.

async function seedEvidence(
  userId: string,
  exerciseId: string,
  kind = 'implemented',
  recordedOn = '2026-07-20',
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into mastery_evidence (user_id, exercise_id, kind, recorded_on) values ($1, $2, $3, $4) returning id`,
    [userId, exerciseId, kind, recordedOn],
  );
  return row.rows[0]!.id;
}

describe('M3-03 mastery_evidence constraints (integration)', () => {
  it('CHECK rejects an invalid kind; a member kind inserts', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    await expect(
      pool.query(
        `insert into mastery_evidence (user_id, exercise_id, kind, recorded_on) values ($1, $2, 'read', '2026-07-20')`,
        [userId, exerciseId],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (kind)');
    const ok = await pool.query<{ kind: string }>(
      `insert into mastery_evidence (user_id, exercise_id, kind, recorded_on) values ($1, $2, 'tested', '2026-07-20') returning kind`,
      [userId, exerciseId],
    );
    expect(ok.rows[0]!.kind).toBe('tested');
  });

  it('recorded_on is NOT NULL; artifact_url is nullable', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    // recorded_on omitted -> not_null_violation (the service always supplies it).
    await expect(
      pool.query(
        `insert into mastery_evidence (user_id, exercise_id, kind) values ($1, $2, 'implemented')`,
        [userId, exerciseId],
      ),
    ).rejects.toSatisfy(rejectsWith('23502'), 'expected not_null_violation (recorded_on)');
    // artifact_url null is fine (an explained/verbal record with no link).
    const ok = await pool.query<{ artifact_url: string | null }>(
      `insert into mastery_evidence (user_id, exercise_id, kind, recorded_on) values ($1, $2, 'explained', '2026-07-20') returning artifact_url`,
      [userId, exerciseId],
    );
    expect(ok.rows[0]!.artifact_url).toBeNull();
  });

  it('a kind may RECUR for one exercise — no UNIQUE constraint (revisited/multi-artifact)', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    await seedEvidence(userId, exerciseId, 'implemented');
    // A second implemented row for the same exercise must succeed — the gate
    // checks existence (>=1), never count, so kinds are free to recur.
    await expect(seedEvidence(userId, exerciseId, 'implemented')).resolves.toBeTruthy();
    const count = await pool.query<{ n: string }>(
      `select count(*) as n from mastery_evidence where exercise_id = $1 and kind = 'implemented'`,
      [exerciseId],
    );
    expect(count.rows[0]!.n).toBe('2');
  });

  it('deleting an exercise cascades to its mastery_evidence (no orphan)', async () => {
    const userId = await insertUser();
    const planId = await seedLearningPlan(userId);
    const exerciseId = await seedExercise(userId, planId);
    await seedEvidence(userId, exerciseId, 'implemented');
    await seedEvidence(userId, exerciseId, 'tested');
    await pool.query(`delete from exercises where id = $1`, [exerciseId]);
    const count = await pool.query<{ n: string }>(`select count(*) as n from mastery_evidence`);
    expect(count.rows[0]!.n).toBe('0');
  });
});

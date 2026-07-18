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

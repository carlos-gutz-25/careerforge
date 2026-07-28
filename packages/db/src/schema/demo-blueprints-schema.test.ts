import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';

// M9-04: demo_blueprints schema constraints (integration) - raw SQL through the
// pool on purpose, so nothing in the Drizzle layer can mask a missing constraint.
// Fixture values are fictional. The gap-SET-NULL and posting-deletion-survival
// behaviors (which need the full fit chain) are pinned in the repository
// integration test (D9); here we pin the user-only constraints: the
// posting_count CHECK, the (user_id, group_key_hash) unique with its md5
// cross-user identity, and the GENERATED md5 column's value.
const handle = createTestDb();
const { pool } = handle;

async function insertUser(email = 'alex.rivera.example@example.com'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users (email, password_hash) values ($1, 'fake-hash') returning id`,
    [email],
  );
  return result.rows[0]!.id;
}

const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

/** Insert one blueprint with fictional section/count defaults; group_key_hash is
 *  GENERATED (never supplied). Returns the inserted row's id + hash. */
function insertBlueprint(userId: string, opts: { groupKey?: string; postingCount?: number } = {}) {
  const groupKey = opts.groupKey ?? 'kubernetes operators';
  const postingCount = opts.postingCount ?? 1;
  return pool.query<{ id: string; group_key_hash: string; gap_id: string | null }>(
    `insert into demo_blueprints
       (user_id, gap_id, group_key, requirement_text, title, scorer_version,
        posting_count, instance_count, must_have_posting_count, nice_to_have_posting_count,
        categories, refs, problem, constraints, deliverables, evidence_required)
     values ($1, null, $2, 'Fictional requirement text', 'Fictional title', 1,
             $3, 1, 1, 0,
             '["technologies"]'::jsonb, '[]'::jsonb,
             'problem text', 'constraints text', 'deliverables text', 'evidence text')
     returning id, group_key_hash, gap_id`,
    [userId, groupKey, postingCount],
  );
}

beforeEach(() => truncateAllTables(handle));
afterAll(() => pool.end());

describe('demo_blueprints schema constraints (integration)', () => {
  it('CHECK rejects posting_count < 1 and accepts >= 1', async () => {
    const userId = await insertUser();
    await expect(insertBlueprint(userId, { postingCount: 0 })).rejects.toSatisfy(
      rejectsWith('23514'),
      'expected check_violation (posting_count >= 1)',
    );
    await expect(insertBlueprint(userId, { postingCount: 1 })).resolves.toBeTruthy();
  });

  it('UNIQUE(user_id, group_key_hash) dedupes one blueprint per skill group per user', async () => {
    const userId = await insertUser();
    await insertBlueprint(userId, { groupKey: 'graphql federation' });
    // Same user, same group_key (=> same md5) violates the unique index.
    await expect(insertBlueprint(userId, { groupKey: 'graphql federation' })).rejects.toSatisfy(
      rejectsWith('23505'),
      'expected unique_violation (user_id, group_key_hash)',
    );
  });

  it('md5 identity is per-user: two users can each hold the same group_key (R7)', async () => {
    const userA = await insertUser('a.example@example.com');
    const userB = await insertUser('b.example@example.com');
    const a = await insertBlueprint(userA, { groupKey: 'rust async runtimes' });
    const b = await insertBlueprint(userB, { groupKey: 'rust async runtimes' });
    // Same key => identical hash, but different users => two rows coexist.
    expect(a.rows[0]!.group_key_hash).toBe(b.rows[0]!.group_key_hash);
    const count = await pool.query<{ n: string }>(
      `select count(*)::text as n from demo_blueprints`,
    );
    expect(count.rows[0]!.n).toBe('2');
  });

  it('group_key_hash is GENERATED as md5(group_key)', async () => {
    const userId = await insertUser();
    const inserted = await insertBlueprint(userId, { groupKey: 'terraform modules' });
    const { rows } = await pool.query<{ group_key_hash: string; expected: string }>(
      `select group_key_hash, md5(group_key) as expected from demo_blueprints where id = $1`,
      [inserted.rows[0]!.id],
    );
    expect(rows[0]!.group_key_hash).toBe(rows[0]!.expected);
    // A client cannot write the generated column directly.
    await expect(
      pool.query(`update demo_blueprints set group_key_hash = 'forged' where id = $1`, [
        inserted.rows[0]!.id,
      ]),
    ).rejects.toSatisfy(rejectsWith('428C9'), 'expected generated-column write rejection');
  });

  it('deleting the user cascades their demo_blueprints (ADR-0007)', async () => {
    const userId = await insertUser();
    await insertBlueprint(userId);
    await pool.query(`delete from users where id = $1`, [userId]);
    const count = await pool.query<{ n: string }>(
      `select count(*)::text as n from demo_blueprints`,
    );
    expect(count.rows[0]!.n).toBe('0');
  });
});

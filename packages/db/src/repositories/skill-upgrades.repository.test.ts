import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { createExercisesRepository } from './exercises.repository.ts';
import { createProfileRepository, type ProfileImportSkill } from './profile.repository.ts';
import {
  createSkillUpgradesRepository,
  type CreateSkillUpgradeInput,
} from './skill-upgrades.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for M3-06 skill-upgrade persistence + the getProfile
// effective-level overlay (dockerized Postgres, migration 0015). Fixtures use
// raw SQL through the pool for the plan/exercise chain; all data fictional
// (RISKS P-01, Alex Rivera vocabulary).

const handle = createTestDb();
const { pool } = handle;
const users = createUsersRepository(handle.db);
const exercises = createExercisesRepository(handle.db);
const profile = createProfileRepository(handle.db);
const repo = createSkillUpgradesRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

let seq = 0;

async function seedUser(): Promise<string> {
  seq += 1;
  const user = await users.create({
    email: `me.fictional.${String(seq)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  return user.id;
}

/** The plan/gap/exercise chain (mirrors the mastery-evidence fixture). Returns
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

async function seedEvidence(
  userId: string,
  exerciseId: string,
  kind: string,
  recordedOn: string,
  artifactUrl: string | null,
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into mastery_evidence (user_id, exercise_id, kind, artifact_url, recorded_on)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, exerciseId, kind, artifactUrl, recordedOn],
  );
  return row.rows[0]!.id;
}

const tsSkill = (level: ProfileImportSkill['level'], name = 'TypeScript'): ProfileImportSkill => ({
  name,
  category: 'language',
  level,
  years: 4,
  lastUsed: '2026-07-01',
});

const importSkills = (userId: string, skills: ProfileImportSkill[]) =>
  profile.syncProfile(userId, { skills, experiences: [], projects: [] });

/** Grant TypeScript -> solid for `userId`, sourced from a fresh exercise with
 *  two evidence rows. Returns the grant + the profile skill id it cites. */
async function grantTypeScriptSolid(
  userId: string,
  overrides: Partial<CreateSkillUpgradeInput> = {},
) {
  const { exerciseId } = await seedExercise(userId);
  const ev1 = await seedEvidence(
    userId,
    exerciseId,
    'implemented',
    '2026-07-10',
    'https://x.test/1',
  );
  const ev2 = await seedEvidence(userId, exerciseId, 'tested', '2026-07-11', null);
  const skillId = (await profile.getProfile(userId)).skills.find(
    (s) => s.name === 'TypeScript',
  )?.id;
  const input: CreateSkillUpgradeInput = {
    profileSkillId: skillId!,
    skillName: 'TypeScript',
    skillNameKey: 'typescript',
    fromLevel: 'rusty',
    toLevel: 'solid',
    exerciseId,
    exerciseTitle: 'Build a typed parser',
    evidence: [
      {
        masteryEvidenceId: ev1,
        kind: 'implemented',
        artifactUrl: 'https://x.test/1',
        recordedOn: '2026-07-10',
      },
      { masteryEvidenceId: ev2, kind: 'tested', artifactUrl: null, recordedOn: '2026-07-11' },
    ],
    ...overrides,
  };
  const grant = await repo.createGrantWithEvidence(userId, input);
  return { grant, skillId: skillId!, exerciseId };
}

describe('createGrantWithEvidence + reads', () => {
  it('inserts a grant + all evidence snapshots and reads them back (owner-scoped)', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    expect(grant.grant.status).toBe('active');
    expect(grant.grant.fromLevel).toBe('rusty');
    expect(grant.grant.toLevel).toBe('solid');
    expect(grant.grant.skillNameKey).toBe('typescript');
    expect(grant.detached).toBe(false);
    expect(grant.evidence.map((e) => e.kind)).toEqual(['implemented', 'tested']);

    const found = await repo.findGrant(userId, grant.grant.id);
    expect(found?.grant.id).toBe(grant.grant.id);
    expect(found?.evidence).toHaveLength(2);

    // owner-scoped: a foreign user sees nothing
    const other = await seedUser();
    expect(await repo.findGrant(other, grant.grant.id)).toBeUndefined();
    expect(await repo.listGrants(other)).toEqual([]);
  });

  it('23505: a second ACTIVE grant for the same (user, skill key) is rejected', async () => {
    // PLANTED-FAIL anchor: dropping the partial unique index (or its WHERE) lets
    // this second insert succeed -> RED. The service maps 23505 -> 409.
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    await grantTypeScriptSolid(userId);
    await expect(grantTypeScriptSolid(userId)).rejects.toSatisfy(
      rejectsWith('23505'),
      'expected unique_violation on the active-grant partial index',
    );
  });

  it('a REVOKED grant does not block a re-grant (partial index is active-scoped)', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);
    expect(await repo.revokeGrant(userId, grant.grant.id, null)).toBe('revoked');
    // re-earn allowed; both rows now exist (append-only history)
    const regrant = await grantTypeScriptSolid(userId);
    expect(regrant.grant.grant.status).toBe('active');
    expect(await repo.listGrants(userId)).toHaveLength(2);
  });
});

describe('cascade-survival (plan delete): the audit trail outlives its sources', () => {
  it('grant + snapshots persist; exercise_id and mastery_evidence_id go NULL', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant, exerciseId } = await grantTypeScriptSolid(userId);

    // Delete the whole plan family -> exercises + mastery_evidence cascade away.
    await pool.query(
      `delete from learning_plans where id in
         (select learning_plan_id from exercises where id = $1)`,
      [exerciseId],
    );

    const after = await repo.findGrant(userId, grant.grant.id);
    expect(after).toBeDefined();
    expect(after!.grant.exerciseId).toBeNull(); // SET NULL
    expect(after!.grant.exerciseTitle).toBe('Build a typed parser'); // snapshot survives
    expect(after!.evidence).toHaveLength(2);
    expect(after!.evidence.every((e) => e.masteryEvidenceId === null)).toBe(true); // SET NULL
    expect(after!.evidence.map((e) => e.kind)).toEqual(['implemented', 'tested']); // snapshots survive
  });
});

describe('revokeGrant (conditional update, race-safe)', () => {
  it('active -> revoked, then already_revoked; unknown/foreign -> not_found', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    expect(await repo.revokeGrant(userId, grant.grant.id, 'wrong level')).toBe('revoked');
    const revoked = await repo.findGrant(userId, grant.grant.id);
    expect(revoked!.grant.status).toBe('revoked');
    expect(revoked!.grant.revokedAt).not.toBeNull();
    expect(revoked!.grant.revokeNote).toBe('wrong level');

    expect(await repo.revokeGrant(userId, grant.grant.id, null)).toBe('already_revoked');
    expect(await repo.revokeGrant(userId, '00000000-0000-4000-8000-000000000000', null)).toBe(
      'not_found',
    );
    const other = await seedUser();
    expect(await repo.revokeGrant(other, grant.grant.id, null)).toBe('not_found');
  });
});

// ── The park-2 proof (M0-08 importer review): full-sync must never destroy or
// orphan an earned upgrade. syncProfile and seed do NOT route through
// getProfile, so the overlay can never feed the importer; and the importer
// never reads/writes skill_upgrades, so a re-import cannot revert a grant.
describe('park-2 proof: re-import can never revert or orphan an earned grant', () => {
  it('(a) identical re-import: all-zero skill counts, grant stays active, effective=solid', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    const resync = await importSkills(userId, [tsSkill('rusty')]);
    expect(resync.skills).toEqual({ inserted: 0, updated: 0, deleted: 0 }); // idempotent

    const after = await repo.findGrant(userId, grant.grant.id);
    expect(after!.grant.status).toBe('active');
    const skill = (await profile.getProfile(userId)).skills.find((s) => s.name === 'TypeScript')!;
    expect(skill.level).toBe('solid'); // effective (earned)
    expect(skill.declaredLevel).toBe('rusty'); // markdown-owned, unchanged
  });

  it('(b) declared level raised to expert: declared updates, grant persists, effective=max', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    const resync = await importSkills(userId, [tsSkill('expert')]);
    expect(resync.skills.updated).toBe(1);

    const after = await repo.findGrant(userId, grant.grant.id);
    expect(after!.grant.status).toBe('active'); // grant untouched
    const skill = (await profile.getProfile(userId)).skills.find((s) => s.name === 'TypeScript')!;
    // max(expert declared, solid earned) = expert — a grant can only ever RAISE.
    expect(skill.level).toBe('expert');
    expect(skill.declaredLevel).toBe('expert');
  });

  it('(c) rename TypeScript -> TS: grant persists, profile_skill_id NULL, detached=true, new name effective=declared', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    // Full-sync rename is delete(TypeScript)+insert(TS): neither the FK nor the
    // key survives, so the grant detaches.
    await importSkills(userId, [tsSkill('rusty', 'TS')]);

    const after = await repo.findGrant(userId, grant.grant.id);
    expect(after!.grant.status).toBe('active'); // NOT reverted
    expect(after!.grant.profileSkillId).toBeNull(); // FK SET NULL by the delete
    expect(after!.grant.skillName).toBe('TypeScript'); // snapshot survives
    expect(after!.detached).toBe(true); // key matches no current skill

    const skills = (await profile.getProfile(userId)).skills;
    expect(skills.find((s) => s.name === 'TypeScript')).toBeUndefined(); // gone
    const ts = skills.find((s) => s.name === 'TS')!;
    expect(ts.level).toBe('rusty'); // no grant for 'ts' -> effective = declared
    expect(ts.declaredLevel).toBe('rusty');
  });

  it('(d) pure deletion: skill removed from skills.md entirely -> grant + snapshots persist, detached, skill drops from getProfile', async () => {
    const userId = await seedUser();
    await importSkills(userId, [tsSkill('rusty')]);
    const { grant } = await grantTypeScriptSolid(userId);

    // TypeScript removed from the markdown ENTIRELY (not renamed).
    const resync = await importSkills(userId, []);
    expect(resync.skills.deleted).toBe(1);

    const after = await repo.findGrant(userId, grant.grant.id);
    expect(after!.grant.status).toBe('active'); // grant survives the deletion
    expect(after!.grant.profileSkillId).toBeNull(); // FK SET NULL
    expect(after!.grant.skillName).toBe('TypeScript'); // display snapshot survives
    expect(after!.evidence).toHaveLength(2); // trail survives
    expect(after!.detached).toBe(true); // no current skill for the key

    const skills = (await profile.getProfile(userId)).skills;
    expect(skills.find((s) => s.name === 'TypeScript')).toBeUndefined(); // dropped
  });
});

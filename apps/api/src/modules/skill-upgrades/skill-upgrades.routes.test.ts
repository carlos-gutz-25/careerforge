import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  type Exercise,
  type ProfileWithDeclaredResponse,
  type SkillUpgrade,
  type SkillUpgradeSuggestionsResponse,
  type SkillUpgradesResponse,
} from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// POST/GET /skill-upgrades + GET /skill-upgrade-suggestions (M3-06). Deterministic
// evidence -> profile upgrades: the server re-derives every grant from the
// exercise + profile state. Fixtures are all fictional (RISKS P-01, Alex Rivera).

const handle = createTestDb();
const env = buildTestEnv();
const { pool } = handle;

const instances: FastifyInstance[] = [];

beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await Promise.all(instances.map((instance) => instance.close()));
  instances.length = 0;
});
afterAll(() => handle.pool.end());

/** An app instance whose server clock is pinned so recordedOn/completedOn are
 *  deterministic and never in the future. */
async function buildAt(
  isoInstant = '2026-07-20T12:00:00Z',
  deps: AppDeps = {},
): Promise<FastifyInstance> {
  const instance = await buildApp(env, {
    dbHandle: handle,
    now: () => new Date(isoInstant),
    ...deps,
  });
  instances.push(instance);
  return instance;
}

type Headers = { cookie: string };

let seq = 0;

async function makeUser(): Promise<{ userId: string; headers: Headers }> {
  seq += 1;
  const user = await createTestUser(handle, {
    email: `upgrader.${seq}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
  return { userId: user.id, headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
}

async function seedSkill(userId: string, name: string, level: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into profile_skills (user_id, name, category, level) values ($1, $2, 'language', $3) returning id`,
    [userId, name, level],
  );
  return row.rows[0]!.id;
}

/** A plan citing one gap whose requirement text is `reqText` (so a skill named
 *  reqText phrase-matches it). Returns the plan id + gap id. */
async function seedPlanWithGap(
  userId: string,
  reqText: string,
): Promise<{ planId: string; gapId: string }> {
  seq += 1;
  const hash = String(seq).padEnd(64, 'e').slice(0, 64);
  const posting = await pool.query<{ id: string }>(
    `insert into job_postings (user_id, raw_text, content_hash) values ($1, 'Fictional posting', $2) returning id`,
    [userId, hash],
  );
  const run = await pool.query<{ id: string }>(
    `insert into extraction_runs
       (user_id, posting_id, provider, model, prompt_id, raw_response,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        latency_ms, attempt, status)
     values ($1, $2, 'anthropic', 'claude', 'extract@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok') returning id`,
    [userId, posting.rows[0]!.id],
  );
  const report = await pool.query<{ id: string }>(
    `insert into fit_reports
       (user_id, posting_id, extraction_run_id, verdict, exclusions, criteria_snapshot,
        forced_lowest, input_flagged)
     values ($1, $2, $3, 'scored', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, false) returning id`,
    [userId, posting.rows[0]!.id, run.rows[0]!.id],
  );
  const req = await pool.query<{ id: string }>(
    `insert into requirements
       (user_id, extraction_run_id, kind, category, text, source_quote, confidence, position)
     values ($1, $2, 'must_have', 'framework', $3, $3, 0.9, 0) returning id`,
    [userId, run.rows[0]!.id, reqText],
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
     values ($1, 'anthropic', 'claude', 'learning-plan@v1', '{}'::jsonb, 0, 0, 0, 0, 0, 1, 'ok') returning id`,
    [userId],
  );
  const plan = await pool.query<{ id: string }>(
    `insert into learning_plans (user_id, title, drafting_run_id) values ($1, 'Fictional plan', $2) returning id`,
    [userId, lrun.rows[0]!.id],
  );
  await pool.query(
    `insert into learning_plan_gaps (user_id, learning_plan_id, gap_id, focus, priority, position)
     values ($1, $2, $3, 'focus', 'high', 0)`,
    [userId, plan.rows[0]!.id, gap.rows[0]!.id],
  );
  return { planId: plan.rows[0]!.id, gapId: gap.rows[0]!.id };
}

/** Create an exercise citing a `reqText` gap, add the evidence in `kinds`, and
 *  (unless keepPlanned) complete it. Returns the exercise id. */
async function makeExercise(
  instance: FastifyInstance,
  headers: Headers,
  userId: string,
  reqText: string,
  kinds: string[] = ['implemented', 'tested', 'explained'],
  keepPlanned = false,
): Promise<string> {
  const { planId, gapId } = await seedPlanWithGap(userId, reqText);
  const created = await instance.inject({
    method: 'POST',
    url: '/exercises',
    headers,
    payload: {
      learningPlanId: planId,
      title: 'Build a typed parser',
      kind: 'kata',
      gapIds: [gapId],
    },
  });
  expect(created.statusCode).toBe(201);
  const exerciseId = created.json<Exercise>().id;
  for (const kind of kinds) {
    const res = await instance.inject({
      method: 'POST',
      url: '/mastery-evidence',
      headers,
      payload: { exerciseId, kind },
    });
    expect(res.statusCode).toBe(201);
  }
  if (!keepPlanned) {
    const patched = await instance.inject({
      method: 'PATCH',
      url: `/exercises/${exerciseId}`,
      headers,
      payload: { status: 'complete' },
    });
    expect(patched.statusCode).toBe(200);
  }
  return exerciseId;
}

async function countGrants(userId: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `select count(*)::text as n from skill_upgrades where user_id = $1`,
    [userId],
  );
  return Number(res.rows[0]!.n);
}

describe('GET /skill-upgrade-suggestions', () => {
  it('401 unauthenticated', async () => {
    const app = await buildAt();
    const res = await app.inject({ method: 'GET', url: '/skill-upgrade-suggestions' });
    expect(res.statusCode).toBe(401);
  });

  it('empty when no completed exercises', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedSkill(userId, 'TypeScript', 'rusty');
    const res = await app.inject({ method: 'GET', url: '/skill-upgrade-suggestions', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json<SkillUpgradeSuggestionsResponse>()).toEqual({ suggestions: [] });
  });

  it('suggests solid for a rusty skill matched by a full-evidence exercise; GET is write-free', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');

    const res = await app.inject({ method: 'GET', url: '/skill-upgrade-suggestions', headers });
    expect(res.statusCode).toBe(200);
    const { suggestions } = res.json<SkillUpgradeSuggestionsResponse>();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.profileSkillId).toBe(skillId);
    expect(suggestions[0]!.currentLevel).toBe('rusty');
    expect(suggestions[0]!.suggestedLevel).toBe('solid');
    expect(suggestions[0]!.exercises.map((e) => e.exerciseId)).toEqual([exerciseId]);
    expect(suggestions[0]!.exercises[0]!.matchedRequirements[0]!.text).toBe('TypeScript');

    // write-free pin (review-queue precedent): the recompute stores nothing.
    expect(await countGrants(userId)).toBe(0);
  });

  it('does not suggest a skill already solid, or one with only completion evidence', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    await seedSkill(userId, 'TypeScript', 'solid'); // already >= target
    await seedSkill(userId, 'Docker', 'rusty');
    // Docker exercise has only implemented+tested (no explained) -> not full.
    await makeExercise(app, headers, userId, 'Docker', ['implemented', 'tested']);

    const res = await app.inject({ method: 'GET', url: '/skill-upgrade-suggestions', headers });
    expect(res.json<SkillUpgradeSuggestionsResponse>().suggestions).toEqual([]);
  });
});

describe('POST /skill-upgrades', () => {
  it('201 grant with full evidence snapshots, from/to levels, skillNameKey, not detached', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');

    const res = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(res.statusCode).toBe(201);
    const grant = res.json<SkillUpgrade>();
    expect(grant.fromLevel).toBe('rusty');
    expect(grant.toLevel).toBe('solid');
    expect(grant.status).toBe('active');
    expect(grant.skillNameKey).toBe('typescript');
    expect(grant.exerciseTitle).toBe('Build a typed parser');
    expect(grant.detached).toBe(false);
    // ALL of the exercise's evidence snapshotted (the acquisition trio).
    expect(grant.evidence.map((e) => e.kind).sort()).toEqual([
      'explained',
      'implemented',
      'tested',
    ]);
  });

  it('404 SKILL_NOT_FOUND (unknown/foreign skill) — checked before the 409', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    const res = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: '00000000-0000-4000-8000-000000000000', exerciseId },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('SKILL_NOT_FOUND');
  });

  it('404 EXERCISE_NOT_FOUND (unknown exercise)', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const res = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('EXERCISE_NOT_FOUND');
  });

  it('409 UPGRADE_NOT_DERIVABLE when the exercise is not complete', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(
      app,
      headers,
      userId,
      'TypeScript',
      ['implemented'],
      true,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UPGRADE_NOT_DERIVABLE');
  });

  it('409 UPGRADE_NOT_DERIVABLE when the skill name does not match the exercise', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'Kubernetes', 'rusty'); // no match
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    const res = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UPGRADE_NOT_DERIVABLE');
  });

  it('409 UPGRADE_NOT_DERIVABLE for a second grant (effective is already solid after the first)', async () => {
    // The active grant raises the skill's EFFECTIVE level to solid, so a repeat
    // POST is no longer derivable — the sequential guard the 23505 backstop only
    // ever has to catch under a true race.
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    const first = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('UPGRADE_NOT_DERIVABLE');
  });
});

describe('GET /profile — effective/declared visibility + fit ripple, and revoke reversion', () => {
  it('grant flips level=effective while declaredLevel stays; revoke reverts', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');

    // before grant: effective == declared == rusty
    const before = await app.inject({ method: 'GET', url: '/profile', headers });
    const beforeSkill = before
      .json<ProfileWithDeclaredResponse>()
      .skills.find((s) => s.id === skillId)!;
    expect(beforeSkill.level).toBe('rusty');
    expect(beforeSkill.declaredLevel).toBe('rusty');

    const grantRes = await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    expect(grantRes.statusCode).toBe(201);
    const grantId = grantRes.json<SkillUpgrade>().id;

    // after grant: level=effective (solid), declaredLevel unchanged (rusty)
    const after = await app.inject({ method: 'GET', url: '/profile', headers });
    const afterSkill = after
      .json<ProfileWithDeclaredResponse>()
      .skills.find((s) => s.id === skillId)!;
    expect(afterSkill.level).toBe('solid');
    expect(afterSkill.declaredLevel).toBe('rusty');

    // after revoke: effective reverts to declared (the active-scoped overlay).
    const revoke = await app.inject({
      method: 'POST',
      url: `/skill-upgrades/${grantId}/revoke`,
      headers,
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);
    const reverted = await app.inject({ method: 'GET', url: '/profile', headers });
    const revertedSkill = reverted
      .json<ProfileWithDeclaredResponse>()
      .skills.find((s) => s.id === skillId)!;
    expect(revertedSkill.level).toBe('rusty');
    expect(revertedSkill.declaredLevel).toBe('rusty');
  });
});

describe('GET /skill-upgrades + revoke ladder + detached', () => {
  it('lists grants; revoke -> 200, again -> 409 already-revoked; unknown/foreign -> 404', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    const grantId = (
      await app.inject({
        method: 'POST',
        url: '/skill-upgrades',
        headers,
        payload: { profileSkillId: skillId, exerciseId },
      })
    ).json<SkillUpgrade>().id;

    const list = await app.inject({ method: 'GET', url: '/skill-upgrades', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json<SkillUpgradesResponse>().upgrades.map((u) => u.id)).toEqual([grantId]);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/skill-upgrades/${grantId}/revoke`,
          headers,
          payload: { note: 'wrong' },
        })
      ).statusCode,
    ).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: `/skill-upgrades/${grantId}/revoke`,
      headers,
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('UPGRADE_ALREADY_REVOKED');

    const unknown = await app.inject({
      method: 'POST',
      url: `/skill-upgrades/00000000-0000-4000-8000-000000000000/revoke`,
      headers,
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);

    // foreign user cannot revoke another user's grant (404, user-scoped)
    const other = await makeUser();
    const foreign = await app.inject({
      method: 'POST',
      url: `/skill-upgrades/${grantId}/revoke`,
      headers: other.headers,
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('an active grant whose skill key no longer matches any skill is detached=true', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    // Rename the skill (its key becomes 'typescript 5' — no longer 'typescript').
    await pool.query(`update profile_skills set name = 'TypeScript 5' where id = $1`, [skillId]);
    const list = await app.inject({ method: 'GET', url: '/skill-upgrades', headers });
    const grant = list.json<SkillUpgradesResponse>().upgrades[0]!;
    expect(grant.detached).toBe(true);
    expect(grant.skillName).toBe('TypeScript'); // snapshot unchanged
  });

  it('cross-user isolation: another user sees no grants', async () => {
    const app = await buildAt();
    const { userId, headers } = await makeUser();
    const skillId = await seedSkill(userId, 'TypeScript', 'rusty');
    const exerciseId = await makeExercise(app, headers, userId, 'TypeScript');
    await app.inject({
      method: 'POST',
      url: '/skill-upgrades',
      headers,
      payload: { profileSkillId: skillId, exerciseId },
    });
    const other = await makeUser();
    const list = await app.inject({
      method: 'GET',
      url: '/skill-upgrades',
      headers: other.headers,
    });
    expect(list.json<SkillUpgradesResponse>().upgrades).toEqual([]);
  });
});

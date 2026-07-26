import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  renderCaseStudyDraftMarkdown,
  type CaseStudy,
  type CaseStudyDraftInput,
  type Exercise,
} from '@careerforge/core';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp } from '../../app.ts';
import { buildTestEnv, createSessionRow, createTestUser } from '../../test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from '../auth/auth.service.ts';

// M4-01 BORN-VALID proof (ADR-0010, plan-gate tension T2): the deterministic
// renderer emits EXACTLY the portfolio honesty grammar. Proven by spawning the
// REAL validator CLI (apps/portfolio/scripts/validate-case-studies.mjs) on
// rendered output, via the validator's own documented out-of-tree target (its
// header lines 28-31 — the P-01 escape hatch). No cross-app import; the
// validator is not modified. All fixtures fictional (Alex Rivera).

const VALIDATOR = fileURLToPath(
  new URL('../../../../portfolio/scripts/validate-case-studies.mjs', import.meta.url),
);

function runValidator(target: string): { status: number; out: string } {
  const result = spawnSync(process.execPath, [VALIDATOR, target], { encoding: 'utf8' });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

const baseInput = (over: Partial<CaseStudyDraftInput> = {}): CaseStudyDraftInput => ({
  title: 'Token-bucket rate limiter',
  provenance: 'personal',
  exerciseTitle: 'Rate limiter kata',
  exerciseKind: 'kata',
  completedOn: '2026-05-14',
  evidence: [
    { kind: 'implemented', artifactUrl: 'https://example.test/pr/7', recordedOn: '2026-05-12' },
    { kind: 'tested', artifactUrl: null, recordedOn: '2026-05-13' },
  ],
  linkedGapCount: 2,
  ...over,
});

// The adversarial matrix from the renderer's own injection tests, plus the
// maximal-evidence and zero-gap edges — every one must render born-valid.
const HOSTILE = [
  '## Evil',
  '# h1',
  '---',
  'provenance: professional',
  '```',
  '"quotes"',
  'a: b: c',
  'line1\n## Evil',
  'line1\r\n## Evil',
  'digits 12345',
  'x'.repeat(200),
];

describe('renderer output is born-valid against the real ADR-0010 validator', () => {
  it('passes exit 0 across the adversarial matrix + maximal-evidence + zero-gap cases', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm401-born-valid-'));
    let n = 0;
    for (const payload of HOSTILE) {
      const md = renderCaseStudyDraftMarkdown(
        baseInput({
          title: payload,
          exerciseTitle: payload,
          evidence: [{ kind: 'implemented', artifactUrl: payload, recordedOn: '2026-05-12' }],
        }),
      );
      await writeFile(path.join(dir, `hostile-${n}.md`), md);
      n += 1;
    }
    // Maximal evidence (all four kinds, some null urls) + personal_ai_assisted.
    await writeFile(
      path.join(dir, 'maximal.md'),
      renderCaseStudyDraftMarkdown(
        baseInput({
          provenance: 'personal_ai_assisted',
          linkedGapCount: 5,
          evidence: [
            { kind: 'implemented', artifactUrl: 'https://x.test/a', recordedOn: '2026-05-01' },
            { kind: 'tested', artifactUrl: null, recordedOn: '2026-05-02' },
            { kind: 'explained', artifactUrl: 'https://x.test/c', recordedOn: '2026-05-03' },
            { kind: 'revisited', artifactUrl: null, recordedOn: '2026-05-04' },
          ],
        }),
      ),
    );
    // Zero gaps + zero evidence (defensive render — still born-valid).
    await writeFile(
      path.join(dir, 'zero.md'),
      renderCaseStudyDraftMarkdown(baseInput({ linkedGapCount: 0, evidence: [] })),
    );

    const { status, out } = runValidator(dir);
    expect(out).toContain('OK');
    expect(status).toBe(0);
  });

  // PLANTED-FAIL leg (evidence-binding): the spawned gate must actually REJECT.
  // A deliberately 6-section file (drop "Tradeoffs") -> validator exit 1 with
  // the R6 message. Proves the born-valid exit-0 above is a real pass, not a
  // gate that never bites.
  it('rejects a 6-section file with exit 1 and an R6 message', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm401-planted-fail-'));
    const full = renderCaseStudyDraftMarkdown(baseInput());
    const sixSection = full.replace('## Tradeoffs\n', '');
    await writeFile(path.join(dir, 'six-section.md'), sixSection);
    const { status, out } = runValidator(dir);
    expect(status).toBe(1);
    expect(out).toContain('R6');
  });
});

// End-to-end: the STORED/EXPORTED bytes (not just the in-memory renderer) are
// born-valid — POST a draft, export it, write the exact bytes, validate.
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

async function buildAt(): Promise<FastifyInstance> {
  const instance = await buildApp(env, {
    dbHandle: handle,
    now: () => new Date('2026-07-20T12:00:00Z'),
  });
  instances.push(instance);
  return instance;
}

let seq = 0;

async function seedCompleteExercise(
  instance: FastifyInstance,
  headers: { cookie: string },
  userId: string,
): Promise<string> {
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
     values ($1, $2, 'must_have', 'framework', 'Some skill', 'Some skill', 0.9, 0) returning id`,
    [userId, run.rows[0]!.id],
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
  const created = await instance.inject({
    method: 'POST',
    url: '/exercises',
    headers,
    payload: {
      learningPlanId: plan.rows[0]!.id,
      title: 'Rate limiter kata',
      kind: 'kata',
      gapIds: [gap.rows[0]!.id],
    },
  });
  const exerciseId = created.json<Exercise>().id;
  for (const kind of ['implemented', 'tested']) {
    await instance.inject({
      method: 'POST',
      url: '/mastery-evidence',
      headers,
      payload: { exerciseId, kind },
    });
  }
  await instance.inject({
    method: 'PATCH',
    url: `/exercises/${exerciseId}`,
    headers,
    payload: { status: 'complete' },
  });
  return exerciseId;
}

describe('exported case-study bytes are born-valid end-to-end', () => {
  it('POST -> export -> validate passes exit 0 on the stored snapshot', async () => {
    const app = await buildAt();
    seq += 1;
    const user = await createTestUser(handle, {
      email: `e2e.${seq}.fictional@example.com`,
      password: 'fictional-integration-password',
    });
    const { token } = await createSessionRow(handle, user.id, new Date('2031-01-01T00:00:00Z'));
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };

    const exerciseId = await seedCompleteExercise(app, headers, user.id);
    const created = await app.inject({
      method: 'POST',
      url: '/case-studies',
      headers,
      payload: { exerciseId, provenance: 'personal_ai_assisted', title: 'Rate limiter write-up' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<CaseStudy>().id;

    const exported = await app.inject({
      method: 'GET',
      url: `/case-studies/${id}/export`,
      headers,
    });
    expect(exported.statusCode).toBe(200);

    const dir = await mkdtemp(path.join(tmpdir(), 'm401-e2e-'));
    const file = path.join(dir, 'exported.md');
    await writeFile(file, exported.body);
    const { status, out } = runValidator(file);
    expect(out).toContain('OK');
    expect(status).toBe(0);
  });
});

// M12-04 cross-system consistency suite (the v2.1 correctness-arc EXIT CRITERION).
// One wholly fictional posting + profile + declared facts drives the FULL HTTP
// surface - import profile+facts -> seed extraction -> POST /fit -> GET /gaps ->
// the four drafting endpoints + GET /market-signal - proving the M12-02/M12-03
// taxonomy AGREES end-to-end: a satisfied_fact never becomes a coaching gap, an
// undeclared requirement surfaces as unknown (never a false genuine_gap), and the
// three evidence-status classes are suppressed from every LLM drafting payload.
// The scoring twin (packages/scoring/src/m12-04-taxonomy.consistency.test.ts) pins
// the same fixture at the pure-engine layer. ALL data is FICTIONAL (RISKS P-01),
// ASCII-only (source-byte law). No gate is modified; no migration; class (a).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  GAP_CLASSIFICATIONS,
  type MarketSignalReport,
  type SearchCriteriaData,
} from '@careerforge/core';
import { MARKET_SIGNAL_HONESTY } from '@careerforge/scoring';
import { createMockProvider } from '@careerforge/llm';
import {
  createExtractionsRepository,
  createProfileFactsRepository,
  createProfileRepository,
  createSearchCriteriaRepository,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';
import { createTestDb, resumeHeaderFixture, truncateAllTables } from '@careerforge/db/test-utils';

import { buildApp, type AppDeps } from './app.ts';
import {
  buildTestEnv,
  createSessionRow,
  createTestUser,
  ORIGIN_HEADER,
} from './test/auth-test-helpers.ts';
import { SESSION_COOKIE_NAME } from './modules/auth/auth.service.ts';

// -- The fictional posting: authored prose (no copied text), every requirement's
//    sourceQuote a verbatim substring below. Fictional employer + role. --------
const FICTIONAL_POSTING = [
  'Aurora Signal Labs - Senior Full-Stack Engineer (Autonomy Platform).',
  'We build fictional autonomy tooling for imaginary fleets.',
  '',
  'What we are looking for:',
  '- minimum of 5 years of professional software engineering experience',
  '- Production experience building services in Rust',
  '- Hands-on COBOL mainframe experience',
  '- Experience with React and GraphQL',
  '',
  'Logistics:',
  '- Base salary range of 150,000 to 180,000 USD',
  '- Onsite in Austin, Texas',
  '',
  'Eligibility:',
  '- Must be authorized to work in the United States',
  '- Pre-employment background check required',
  '- No visa sponsorship is available for this role',
  '- Active security clearance required',
].join('\n');

type Category = RequirementInsert['category'];
type Verdict = { classification: string; evaluator: string; confidence: string | null };
interface Spec {
  ref: string;
  category: Category;
  text: string;
  sourceQuote: string;
  expect: Verdict;
}

// The canonical requirement set + expected engine verdict per requirement. The
// scoring twin pins the identical map against classifyGaps directly.
const SPECS: Spec[] = [
  {
    ref: 'R1',
    category: 'seniority',
    text: 'minimum of 5 years of professional software engineering experience',
    sourceQuote: 'minimum of 5 years of professional software engineering experience',
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'seniority_threshold',
      confidence: 'high',
    },
  },
  {
    ref: 'R2',
    category: 'other',
    text: 'Must be authorized to work in the United States',
    sourceQuote: 'Must be authorized to work in the United States',
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'durable_profile_fact',
      confidence: 'high',
    },
  },
  {
    ref: 'R3',
    category: 'language',
    text: 'Production experience building services in Rust',
    sourceQuote: 'Production experience building services in Rust',
    expect: { classification: 'genuine_gap', evaluator: 'skill_evidence', confidence: null },
  },
  {
    ref: 'R4',
    category: 'language',
    text: 'Hands-on COBOL mainframe experience',
    sourceQuote: 'Hands-on COBOL mainframe experience',
    expect: { classification: 'unknown', evaluator: 'skill_evidence', confidence: 'low' },
  },
  {
    ref: 'R5',
    category: 'comp',
    text: 'Base salary range of 150,000 to 180,000 USD',
    sourceQuote: 'Base salary range of 150,000 to 180,000 USD',
    expect: {
      classification: 'not_applicable',
      evaluator: 'dimension_delegation',
      confidence: 'high',
    },
  },
  {
    ref: 'R6',
    category: 'location',
    text: 'Onsite in Austin, Texas',
    sourceQuote: 'Onsite in Austin, Texas',
    expect: {
      classification: 'not_applicable',
      evaluator: 'dimension_delegation',
      confidence: 'high',
    },
  },
  {
    ref: 'R7',
    category: 'framework',
    text: 'Experience with React and GraphQL',
    sourceQuote: 'Experience with React and GraphQL',
    // Compound baseline: React (solid, direct link, no bridge) => have_undemonstrated;
    // GraphQL unmet but the compound classifies off React alone (F6 baseline for
    // the future atomic-extraction arc, NOT a fix).
    expect: {
      classification: 'have_undemonstrated',
      evaluator: 'skill_evidence',
      confidence: null,
    },
  },
  {
    ref: 'R8',
    category: 'other',
    text: 'Pre-employment background check required',
    sourceQuote: 'Pre-employment background check required',
    expect: { classification: 'unknown', evaluator: 'administrative_pattern', confidence: 'low' },
  },
  {
    ref: 'R9',
    category: 'other',
    text: 'No visa sponsorship is available for this role',
    sourceQuote: 'No visa sponsorship is available for this role',
    expect: {
      classification: 'satisfied_fact',
      evaluator: 'durable_profile_fact',
      confidence: 'high',
    },
  },
  {
    ref: 'R10',
    category: 'other',
    text: 'Active security clearance required',
    sourceQuote: 'Active security clearance required',
    expect: { classification: 'unknown', evaluator: 'durable_profile_fact', confidence: 'low' },
  },
];

const byRef = (ref: string): Spec => {
  const spec = SPECS.find((s) => s.ref === ref);
  if (!spec) throw new Error(`no spec ${ref}`);
  return spec;
};

const EVIDENCE_STATUS = ['satisfied_fact', 'unknown', 'not_applicable'] as const;

const CRITERIA: SearchCriteriaData = {
  // No hard filter fires on the fixture requirements, so the report verdict is
  // 'scored' (never 'excluded') - a prerequisite for the market-signal cohort.
  hardFilters: { employment_type: ['contract'] },
  positiveSignals: {
    role: ['senior'],
    technologies: ['typescript'],
    problem_domains: ['event_driven'],
    work_arrangement: ['remote'],
    scope: ['platform'],
  },
  negativeSignals: ['gamedev_crunch'],
  forceLowestPriority: { industry: ['defense'] },
  compBounds: { currency: 'usd', base_preferred_min: 150_000, base_preferred_max: 190_000 },
};

function runInsert(overrides: Partial<ExtractionRunInsert> = {}): ExtractionRunInsert {
  return {
    promptId: 'extract-requirements@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 25,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    ...overrides,
  };
}

function requirementInsertFor(spec: Spec): RequirementInsert {
  return {
    kind: 'must_have',
    category: spec.category,
    text: spec.text,
    sourceQuote: spec.sourceQuote,
    confidence: 0.9,
    quoteVerified: true,
  };
}

const handle = createTestDb();
const env = buildTestEnv();
const extractions = createExtractionsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const criteriaRepo = createSearchCriteriaRepository(handle.db);
const factsRepo = createProfileFactsRepository(handle.db);

let app: FastifyInstance | undefined;
beforeEach(() => truncateAllTables(handle));
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => handle.pool.end());

async function build(deps: AppDeps = {}): Promise<FastifyInstance> {
  app = await buildApp(env, { dbHandle: handle, ...deps });
  return app;
}

let userSequence = 0;
async function authed() {
  userSequence += 1;
  const user = await createTestUser(handle, {
    email: `m1204.${userSequence}.fictional@example.com`,
    password: 'fictional-integration-password',
  });
  const { token } = await createSessionRow(handle, user.id);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, ...ORIGIN_HEADER };
  return { user, headers };
}

/** Seed the fictional profile + declared facts (spelled-out country for a
 *  high-confidence work-auth satisfy; visa 'no'; clearance 'none'; stances). */
async function seedProfile(userId: string): Promise<void> {
  await profileRepo.syncProfile(userId, {
    ...resumeHeaderFixture(),
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 10, lastUsed: null },
      { name: 'Node.js', category: 'runtime', level: 'solid', years: 9, lastUsed: null },
      { name: 'React', category: 'framework', level: 'solid', years: 8, lastUsed: null },
      { name: 'PostgreSQL', category: 'database', level: 'solid', years: 8, lastUsed: null },
      // The D11 rung: a learning-level Rust makes R3 a genuine_gap (not unknown).
      { name: 'Rust', category: 'language', level: 'learning', years: 0, lastUsed: null },
    ],
    // One long-tenure experience so the seniority span (>= 14y at any plausible
    // scoring date) is comfortably above the demanded 5 years.
    experiences: [
      {
        company: 'Fictional Gizmo Works',
        title: 'Senior Software Engineer',
        startDate: '2012-01-01',
        endDate: null,
        bullets: [],
      },
    ],
    projects: [],
  });
  await factsRepo.syncFacts(userId, [
    {
      kind: 'work_authorization',
      value: 'US citizen, authorized to work in the United States',
      note: null,
      declaredAt: '2026-01-15',
    },
    { kind: 'visa_sponsorship_needed', value: 'no', note: null, declaredAt: '2026-01-15' },
    { kind: 'security_clearance', value: 'none', note: null, declaredAt: '2026-01-15' },
    {
      kind: 'relocation_stance',
      value: 'open_for_right_opportunity',
      note: null,
      declaredAt: '2026-01-15',
    },
    { kind: 'remote_onsite_stance', value: 'flexible', note: null, declaredAt: '2026-01-15' },
  ]);
  await criteriaRepo.upsert(userId, CRITERIA);
}

interface GapWire {
  id: string;
  requirementId: string;
  classification: string;
  engineClassification: string;
  evaluator: string | null;
  confidence: string | null;
  rationale: string;
  requirementText: string;
  requirementCategory: string;
}

/** Full chain: paste the fictional posting, direct-seed the extraction with the
 *  given specs (deterministic category+verified-quote, the fit/plans e2e
 *  precedent), seed profile+facts+criteria, POST /fit. Returns the report id +
 *  the gap rows keyed by requirement text. Optionally reviews the report. */
async function seedScored(
  instance: FastifyInstance,
  userId: string,
  headers: Record<string, string>,
  specs: Spec[],
  { review = false }: { review?: boolean } = {},
): Promise<{ postingId: string; reportId: string; gapsByText: Map<string, GapWire> }> {
  const paste = await instance.inject({
    method: 'POST',
    url: '/postings',
    headers,
    payload: { rawText: FICTIONAL_POSTING },
  });
  const postingId = paste.json<{ posting: { id: string } }>().posting.id;
  await extractions.persistExtraction(
    userId,
    postingId,
    [runInsert()],
    specs.map(requirementInsertFor),
  );
  await seedProfile(userId);
  const scored = await instance.inject({
    method: 'POST',
    url: `/postings/${postingId}/fit`,
    headers,
  });
  expect(scored.statusCode).toBe(201);
  const scoredBody = scored.json<{ id: string; report: { verdict: string } }>();
  // Not excluded: 'scored' is the market-signal cohort prerequisite; pin it at
  // the seed site so an accidental hard-filter hit fails here, not indirectly.
  expect(scoredBody.report.verdict).toBe('scored');
  const reportId = scoredBody.id;
  const gapsRes = await instance.inject({
    method: 'GET',
    url: `/fit-reports/${reportId}/gaps`,
    headers,
  });
  expect(gapsRes.statusCode).toBe(200);
  const gaps = gapsRes.json<{ gaps: GapWire[] }>().gaps;
  const gapsByText = new Map(gaps.map((g) => [g.requirementText, g]));
  if (review) {
    const reviewed = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/review`,
      headers,
    });
    expect(reviewed.statusCode).toBe(200);
  }
  return { postingId, reportId, gapsByText };
}

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 1: classification agreement (POST /fit -> GET /gaps)', () => {
  it('each requirement classifies to its expected {classification, evaluator, confidence}', async () => {
    const instance = await build();
    const { user, headers } = await authed();
    const { gapsByText } = await seedScored(instance, user.id, headers, SPECS);

    expect(gapsByText.size).toBe(SPECS.length);
    for (const spec of SPECS) {
      const gap = gapsByText.get(spec.text);
      if (!gap) throw new Error(`no gap for ${spec.ref}`);
      expect(gap.classification).toBe(spec.expect.classification);
      expect(gap.engineClassification).toBe(spec.expect.classification); // no override
      expect(gap.evaluator).toBe(spec.expect.evaluator);
      expect(gap.confidence).toBe(spec.expect.confidence);
    }
    // The location stance clause rides the R6 rationale (a stance never gaps).
    expect(gapsByText.get(byRef('R6').text)?.rationale).toContain('right role');
  });

  it('invariants hold on the wire: evaluator-satisfied never genuine_gap; no-signal is unknown', async () => {
    const instance = await build();
    const { user, headers } = await authed();
    const { gapsByText } = await seedScored(instance, user.id, headers, SPECS);

    for (const spec of SPECS) {
      const gap = gapsByText.get(spec.text)!;
      if (spec.expect.classification === 'satisfied_fact') {
        expect(gap.classification).not.toBe('genuine_gap'); // I1
      }
    }
    // I2: the no-evidence, no-positive-signal skill requirement (R4) is unknown.
    expect(gapsByText.get(byRef('R4').text)?.classification).toBe('unknown');
  });
});

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 2: plan-family suppression (improvement + learning)', () => {
  const IMPROVEMENT_DRAFT = JSON.stringify({
    items: [
      {
        gapRef: 'g1',
        action: 'Ship a fictional Rust service and document it.',
        priority: 'high',
        recommendations: [],
      },
      {
        gapRef: 'g2',
        action: 'Publish a small React and GraphQL demo.',
        priority: 'medium',
        recommendations: [],
      },
    ],
  });
  const LEARNING_DRAFT = JSON.stringify({
    title: 'Fictional close-the-gaps plan',
    items: [
      { gapRef: 'g1', focus: 'Build a fictional Rust services lab.', priority: 'high' },
      { gapRef: 'g2', focus: 'Rebuild a small app in React and GraphQL.', priority: 'medium' },
    ],
  });

  it('improvement-plan payload carries only genuine_gap + have_undemonstrated; the 3 evidence-status classes are absent', async () => {
    const provider = createMockProvider([{ text: IMPROVEMENT_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const { user, headers } = await authed();
    const { reportId } = await seedScored(instance, user.id, headers, SPECS, { review: true });

    const drafted = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/improvement-plan`,
      headers,
    });
    expect(drafted.statusCode).toBe(201);

    const sent = provider.requests[0]?.messages[0]?.content ?? '';
    // The two eligible (non-have, non-evidence-status) gaps reach the payload,
    // asserted via the payload-unique JSON key:value form (the improvement/
    // learning payload key is `classification`; the bare class words could also
    // sit in the prompt instructions, so key off the serialized payload).
    expect(sent).toContain(byRef('R3').text);
    expect(sent).toContain(byRef('R7').text);
    expect(sent).toContain('"classification": "genuine_gap"');
    expect(sent).toContain('"classification": "have_undemonstrated"');
    // ...and NONE of the three evidence-status classifications do.
    for (const cls of EVIDENCE_STATUS) expect(sent).not.toContain(cls);
    // The suppressed requirements' texts never enter the drafting payload.
    for (const ref of ['R1', 'R2', 'R4', 'R5', 'R6', 'R8', 'R9', 'R10']) {
      expect(sent).not.toContain(byRef(ref).text);
    }
  });

  it('learning-plan (caller-selected gaps) drops the evidence-status gaps from the payload', async () => {
    const provider = createMockProvider([{ text: LEARNING_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const { user, headers } = await authed();
    const { gapsByText } = await seedScored(instance, user.id, headers, SPECS, { review: true });

    // Select EVERY gap - even the evidence-status ones - and prove the builder
    // filters them out (the suppression is server-side, never caller trust).
    const gapIds = [...gapsByText.values()].map((g) => g.id);
    const drafted = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers,
      payload: { gapIds },
    });
    expect(drafted.statusCode).toBe(201);

    const sent = provider.requests[0]?.messages[0]?.content ?? '';
    expect(sent).toContain(byRef('R3').text);
    expect(sent).toContain(byRef('R7').text);
    for (const cls of EVIDENCE_STATUS) expect(sent).not.toContain(cls);
    for (const ref of ['R1', 'R2', 'R4', 'R5', 'R6', 'R8', 'R9', 'R10']) {
      expect(sent).not.toContain(byRef(ref).text);
    }
  });
});

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 3: requirement-family suppression (interview-prep + gameplan)', () => {
  // r3 = R3 (genuine_gap) and r7 = R7 (have_undemonstrated) are the two
  // disclosure-obliged refs (verified-order r{index+1}); disclose on both.
  const INTERVIEW_DRAFT = JSON.stringify({
    questions: [
      {
        requirementRef: 'r3',
        kind: 'technical',
        question: 'How would you approach building production services in Rust here?',
        evidencePoints: [],
        gapDisclosures: ['Be upfront: Rust is at a learning level; point to the plan to close it.'],
      },
      {
        requirementRef: 'r7',
        kind: 'behavioral',
        question: 'Walk me through your React and GraphQL work.',
        evidencePoints: [],
        gapDisclosures: ['Be upfront: GraphQL is not yet demonstrated in production.'],
      },
    ],
  });

  function assertRequirementPayloadSuppression(sent: string): void {
    // Every requirement (verified) serializes into the payload...
    for (const spec of SPECS) expect(sent).toContain(spec.text);
    // ...but a gapClassification is emitted ONLY for the two non-evidence-status
    // gaps. Assert the payload-unique JSON key:value form: the bare class words
    // also appear in the interview-prep prompt INSTRUCTIONS, so a bare
    // toContain('genuine_gap') would be vacuous - it must key off the serialized
    // payload (JSON.stringify(..., null, 2) => `"gapClassification": "..."`).
    expect(sent).toContain('"gapClassification": "genuine_gap"');
    expect(sent).toContain('"gapClassification": "have_undemonstrated"');
    // The three evidence-status classifications never appear anywhere (verified
    // absent from all four prompts' instructions, so the bare form is sound).
    for (const cls of EVIDENCE_STATUS) expect(sent).not.toContain(cls);
  }

  it('interview-prep drafts (201) and its payload carries no evidence-status classification', async () => {
    const provider = createMockProvider([{ text: INTERVIEW_DRAFT }]);
    const instance = await build({ llmProvider: provider });
    const { user, headers } = await authed();
    const { postingId } = await seedScored(instance, user.id, headers, SPECS, { review: true });

    const drafted = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/interview-prep`,
      headers,
    });
    expect(drafted.statusCode).toBe(201);
    // A clean draft (disclosures match the server-anchored obligations r3+r7).
    expect(drafted.json<{ prep: unknown }>().prep).not.toBeNull();

    assertRequirementPayloadSuppression(provider.requests[0]?.messages[0]?.content ?? '');
  });

  it('gameplan payload carries no evidence-status classification (the payload is the suppression contract)', async () => {
    // The payload sent to the provider is captured on the FIRST call regardless
    // of the response, so suppression is asserted on what the LLM RECEIVES. Two
    // schema-failing responses drive a deterministic 201 schema_failed terminal
    // (the house schema-failure idiom: one retry); the gameplan happy path
    // itself is covered by gameplan.routes.test.ts.
    const provider = createMockProvider([{ text: 'not json' }, { text: 'still not json' }]);
    const instance = await build({ llmProvider: provider });
    const { user, headers } = await authed();
    const { postingId } = await seedScored(instance, user.id, headers, SPECS, { review: true });

    const drafted = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/gameplan`,
      headers,
    });
    expect(drafted.statusCode).toBe(201); // any terminal (here schema_failed) is a 201 result
    expect(provider.requests.length).toBeGreaterThanOrEqual(1);

    assertRequirementPayloadSuppression(provider.requests[0]?.messages[0]?.content ?? '');
  });
});

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 4: the differing 409 gate on an all-evidence-status report', () => {
  // A report whose gaps are ONLY evidence-status: R2 (satisfied_fact), R4
  // (unknown), R5 (not_applicable) - no genuine_gap, no have_undemonstrated.
  const EVIDENCE_ONLY = [byRef('R2'), byRef('R4'), byRef('R5')];

  it('improvement + learning 409 NO_ACTIONABLE_GAPS; interview + gameplan clear the gap gate (503 for no provider)', async () => {
    const instance = await build(); // no provider: the differing gate is reached before any LLM call
    const { user, headers } = await authed();
    const { reportId, postingId, gapsByText } = await seedScored(
      instance,
      user.id,
      headers,
      EVIDENCE_ONLY,
      { review: true },
    );
    // Sanity: every gap on this report is an evidence-status class.
    for (const gap of gapsByText.values()) {
      expect(EVIDENCE_STATUS as readonly string[]).toContain(gap.classification);
    }

    const improvement = await instance.inject({
      method: 'POST',
      url: `/fit-reports/${reportId}/improvement-plan`,
      headers,
    });
    expect(improvement.statusCode).toBe(409);
    expect(improvement.json<{ error: { code: string } }>().error.code).toBe('NO_ACTIONABLE_GAPS');

    const learning = await instance.inject({
      method: 'POST',
      url: '/learning-plans',
      headers,
      payload: { gapIds: [...gapsByText.values()].map((g) => g.id) },
    });
    expect(learning.statusCode).toBe(409);
    expect(learning.json<{ error: { code: string } }>().error.code).toBe('NO_ACTIONABLE_GAPS');

    // The requirement family gates on verified requirements, NOT on gap class:
    // all three are quote-verified, so the gap gate is cleared and the missing
    // provider surfaces instead (proving the different 409 semantics).
    const interview = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/interview-prep`,
      headers,
    });
    expect(interview.statusCode).toBe(503);
    expect(interview.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');

    const gameplan = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/gameplan`,
      headers,
    });
    expect(gameplan.statusCode).toBe(503);
    expect(gameplan.json<{ error: { code: string } }>().error.code).toBe('LLM_NOT_CONFIGURED');
  });
});

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 5: market-signal cohort placement (isolated user, no review needed)', () => {
  it('unknown -> needs_input (x3), satisfied_fact/not_applicable -> covered_or_low_priority, genuine_gap -> build', async () => {
    const instance = await build();
    const { user, headers } = await authed();
    // market-signal aggregates the latest report per posting regardless of
    // review; beforeEach truncation keeps this user's cohort to one posting.
    await seedScored(instance, user.id, headers, SPECS);

    const res = await instance.inject({ method: 'GET', url: '/market-signal', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json<MarketSignalReport>();

    expect(body.scorerVersion).toBe(2);
    expect(body.honesty).toBe(MARKET_SIGNAL_HONESTY);
    expect(body.groupCount).toBe(SPECS.length);
    expect(body.instanceCount).toBe(SPECS.length);
    expect(body.cohort.postingsConsidered).toBe(1);
    expect(body.cohort.postingsWithSignal).toBe(1);
    expect(body.cohort.excludedVerdictPostings).toBe(0);
    expect(body.cohort.postingsArchived).toBe(0);

    // Index every emitted actionable-bucket group by its key (= requirement text).
    const bucketGroups = new Map(
      [
        ...body.buckets.sharpen,
        ...body.buckets.prove,
        ...body.buckets.build,
        ...body.buckets.certify,
      ].map((g) => [g.key, g]),
    );
    const noAction = new Map(body.noAction.map((g) => [g.key, g]));

    // unknown (R4/R8/R10) -> noAction reason needs_input, needsInputCount 1 each.
    const needsInput = body.noAction.filter((g) => g.reason === 'needs_input');
    expect(needsInput).toHaveLength(3);
    for (const ref of ['R4', 'R8', 'R10']) {
      const g = noAction.get(byRef(ref).text);
      expect(g?.reason).toBe('needs_input');
      expect(g?.needsInputCount).toBe(1);
      expect(g?.classificationCounts.unknown).toBe(1);
    }

    // satisfied_fact (R1/R2/R9) -> covered_or_low_priority, per-class count pinned
    // (covered_or_low_priority lumps satisfied_fact/not_applicable/have together,
    // so the classificationCounts check is what proves the class per the plan's
    // refs[].classification-agreement clause).
    for (const ref of ['R1', 'R2', 'R9']) {
      const g = noAction.get(byRef(ref).text);
      expect(g?.reason).toBe('covered_or_low_priority');
      expect(g?.needsInputCount).toBe(0);
      expect(g?.classificationCounts.satisfied_fact).toBe(1);
    }
    // not_applicable (R5/R6) -> covered_or_low_priority, per-class count pinned.
    for (const ref of ['R5', 'R6']) {
      const g = noAction.get(byRef(ref).text);
      expect(g?.reason).toBe('covered_or_low_priority');
      expect(g?.needsInputCount).toBe(0);
      expect(g?.classificationCounts.not_applicable).toBe(1);
    }

    // genuine_gap (R3) -> Build; have_undemonstrated (R7) is actionable (a bucket),
    // never noAction. Per-class counts pin the classification at the signal layer.
    const r3Group = body.buckets.build.find((g) => g.key === byRef('R3').text);
    expect(r3Group?.classificationCounts.genuine_gap).toBe(1);
    const r7Group = bucketGroups.get(byRef('R7').text);
    expect(r7Group).toBeDefined();
    expect(r7Group?.classificationCounts.have_undemonstrated).toBe(1);
    expect(noAction.has(byRef('R7').text)).toBe(false);

    // Every group's classificationCounts carries ALL 8 vocabulary keys (the
    // derived-from-GAP_CLASSIFICATIONS honesty invariant).
    const anyGroup = body.noAction[0] ?? body.buckets.build[0];
    expect(Object.keys(anyGroup!.classificationCounts).sort()).toEqual(
      [...GAP_CLASSIFICATIONS].sort(),
    );
  });
});

// -----------------------------------------------------------------------------
describe('M12-04 sub-case 6: the mocked-provider extraction leg (paste -> extract -> score)', () => {
  // A small fictional posting whose rawText contains each sourceQuote verbatim,
  // driven through the REAL POST /extract path via a scripted mock provider -
  // proving the taxonomy also holds when requirements arrive from extraction,
  // not just a direct seed.
  const SMALL_SPECS = [byRef('R1'), byRef('R3'), byRef('R4')];
  const SMALL_POSTING = [
    'Aurora Signal Labs - Platform Engineer (fictional).',
    'minimum of 5 years of professional software engineering experience.',
    'Production experience building services in Rust.',
    'Hands-on COBOL mainframe experience.',
  ].join('\n');
  const EXTRACTION_OUTPUT = JSON.stringify({
    requirements: SMALL_SPECS.map((s) => ({
      kind: 'must_have',
      category: s.category,
      text: s.text,
      sourceQuote: s.sourceQuote,
      confidence: 0.9,
    })),
  });

  it('requirements extracted via the mock provider classify identically to the direct-seed path', async () => {
    const provider = createMockProvider([{ text: EXTRACTION_OUTPUT }]);
    const instance = await build({ llmProvider: provider });
    const { user, headers } = await authed();
    await seedProfile(user.id);

    const paste = await instance.inject({
      method: 'POST',
      url: '/postings',
      headers,
      payload: { rawText: SMALL_POSTING },
    });
    const postingId = paste.json<{ posting: { id: string } }>().posting.id;

    const extracted = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/extract`,
      headers,
    });
    expect(extracted.statusCode).toBe(201);

    const scored = await instance.inject({
      method: 'POST',
      url: `/postings/${postingId}/fit`,
      headers,
    });
    expect(scored.statusCode).toBe(201);
    const reportId = scored.json<{ id: string }>().id;
    const gaps = (
      await instance.inject({ method: 'GET', url: `/fit-reports/${reportId}/gaps`, headers })
    ).json<{ gaps: GapWire[] }>().gaps;
    const gapsByText = new Map(gaps.map((g) => [g.requirementText, g]));

    for (const spec of SMALL_SPECS) {
      const gap = gapsByText.get(spec.text);
      expect(gap?.classification).toBe(spec.expect.classification);
      expect(gap?.evaluator).toBe(spec.expect.evaluator);
    }
  });
});

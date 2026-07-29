import {
  FIT_DIMENSIONS,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository } from './fit-reports.repository.ts';
import {
  createInterviewPrepsRepository,
  deriveInterviewRunStatus,
  type InterviewPrepRunInsert,
  type InterviewQuestionInsert,
} from './interview-preps.repository.ts';
import { createLearningPlansRepository } from './learning-plans.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M3-04 interview-prep persistence path (dockerized
// Postgres, migration 0013). All fixture data fictional (RISKS P-01).

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const learningRepo = createLearningPlansRepository(handle.db);
const interviewRepo = createInterviewPrepsRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

const CRITERIA: SearchCriteriaData = {
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

let seedSequence = 0;

async function seedUserAndPosting() {
  seedSequence += 1;
  const user = await users.create({
    email: `interview.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional Gizmo Works hiring. Requirements: TypeScript. Kubernetes operations.',
    contentHash: String(seedSequence).padEnd(64, 'e').slice(0, 64),
    company: 'Fictional Gizmo Works',
    title: 'Senior Engineer',
    sourceNote: null,
  });
  return { user, posting };
}

interface SeedRequirement {
  text: string;
  /** The write path deliberately admits only booleans (every new requirement
   *  lands verified, M1-06); tests that need a NULL simulate a pre-backfill
   *  legacy row with a raw UPDATE after seeding. */
  quoteVerified: boolean;
}

async function extractRun(userId: string, postingId: string, specs: SeedRequirement[]) {
  const outcome = await extractions.persistExtraction(
    userId,
    postingId,
    [
      {
        promptId: 'extract-requirements@v1',
        provider: 'mock',
        model: 'mock-sonnet',
        rawResponse: { mock: true },
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        latencyMs: 5,
        attempt: 1,
        status: 'ok',
        createdAt: new Date('2026-07-25T09:00:00.000Z'),
      },
    ],
    specs.map((spec) => ({
      kind: 'must_have' as const,
      category: 'other' as const,
      text: spec.text,
      sourceQuote: `quote: ${spec.text}`,
      confidence: 0.9,
      quoteVerified: spec.quoteVerified,
    })),
  );
  const run = outcome.runs[0];
  if (!run) throw new Error('seed produced no run');
  return { run, requirements: outcome.requirements };
}

function reportData(evidenceFor?: { requirementId: string }): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: FIT_DIMENSIONS.map((dimension, index) => ({
      dimension,
      score: 0.5,
      rationale: `fictional ${dimension} rationale`,
      evidence:
        index === 0 && evidenceFor
          ? [
              {
                requirementId: evidenceFor.requirementId,
                profileSkillId: null,
                profileProjectId: null,
                profileExperienceId: null,
                postingQuote: 'Kubernetes operations',
                profileQuote: 'Ran a fictional cluster lab',
                strength: 'adjacent' as const,
              },
            ]
          : [],
    })),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
  };
}

function runInsert(overrides: Partial<InterviewPrepRunInsert> = {}): InterviewPrepRunInsert {
  return {
    promptId: 'interview-prep@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 2600,
    outputTokens: 900,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 5000,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    ...overrides,
  };
}

/** Seed a full chain: two requirements (both verified), a gap on the FIRST
 *  only, evidence on the first. Returns the pieces the persistence tests
 *  need. */
async function seedReportChain() {
  const { user, posting } = await seedUserAndPosting();
  const { run, requirements } = await extractRun(user.id, posting.id, [
    { text: 'Kubernetes cluster operations', quoteVerified: true },
    { text: 'TypeScript', quoteVerified: true },
  ]);
  const gapped = requirements[0]!;
  const assignments: GapAssignment[] = [
    {
      requirementId: gapped.id,
      classification: 'genuine_gap',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: 'No named-skill evidence.',
    },
  ];
  const outcome = await fitRepo.persistFitReport(
    user.id,
    posting.id,
    run.id,
    reportData({ requirementId: gapped.id }),
    CRITERIA,
    assignments,
  );
  return { user, posting, requirements, report: outcome.report, gaps: outcome.gaps };
}

describe('posting resolve reads', () => {
  it('findPostingId: present for the owner, absent for a foreign user', async () => {
    const { user, posting } = await seedUserAndPosting();
    const other = await users.create({
      email: 'other.fictional@example.com',
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await interviewRepo.findPostingId(user.id, posting.id)).toBe(posting.id);
    expect(await interviewRepo.findPostingId(other.id, posting.id)).toBeUndefined();
  });

  it('findLatestReportForPosting returns the NEWEST report after a re-score', async () => {
    const { user, posting, requirements } = await seedReportChain();
    // Re-score: a second report on the same posting, strictly later.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const { run: run2 } = await extractRun(user.id, posting.id, [
      { text: 'Kubernetes cluster operations v2', quoteVerified: true },
    ]);
    const second = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run2.id,
      reportData(),
      CRITERIA,
      [],
    );
    const latest = await interviewRepo.findLatestReportForPosting(user.id, posting.id);
    expect(latest?.id).toBe(second.report.id);
    expect(requirements.length).toBe(2);
  });

  it('findLatestReportForPosting is undefined when the posting has no report', async () => {
    const { user, posting } = await seedUserAndPosting();
    expect(await interviewRepo.findLatestReportForPosting(user.id, posting.id)).toBeUndefined();
  });
});

describe('findRequirementsForReport', () => {
  it('returns tri-state quoteVerified rows in (position, id) order with the gap LEFT JOIN', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, [
      { text: 'Verified and gapped', quoteVerified: true },
      { text: 'Verified, no gap row', quoteVerified: true },
      { text: 'Failed verification', quoteVerified: false },
      { text: 'Never verified', quoteVerified: true },
    ]);
    // Simulate the pre-M1-06 legacy state the read must handle: NULL =
    // verification never ran (the write path only admits booleans).
    await handle.pool.query(`update requirements set quote_verified = null where id = $1`, [
      requirements[3]!.id,
    ]);
    const outcome = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      reportData(),
      CRITERIA,
      [
        {
          requirementId: requirements[0]!.id,
          classification: 'needs_refresh',
          evaluator: 'skill_evidence',
          confidence: null,
          rationale: 'Rusty fictional skill.',
        },
      ],
    );
    const rows = await interviewRepo.findRequirementsForReport(user.id, outcome.report.id);
    expect(rows.map((row) => row.text)).toEqual([
      'Verified and gapped',
      'Verified, no gap row',
      'Failed verification',
      'Never verified',
    ]);
    expect(rows.map((row) => row.quoteVerified)).toEqual([true, true, false, null]);
    // The gap LEFT JOIN: only the assigned requirement carries gap fields.
    expect(rows[0]!.gapId).toBe(outcome.gaps[0]!.id);
    expect(rows[0]!.gapClassification).toBe('needs_refresh');
    expect(rows[1]!.gapId).toBeNull();
    expect(rows[1]!.gapClassification).toBeNull();
  });
});

describe('findEvidenceForReport', () => {
  it('returns the report-scoped links WITH ids, requirement-keyed', async () => {
    const { user, report, requirements } = await seedReportChain();
    const rows = await interviewRepo.findEvidenceForReport(user.id, report.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requirementId).toBe(requirements[0]!.id);
    expect(rows[0]!.evidenceLinkId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]!.strength).toBe('adjacent');
    expect(rows[0]!.postingQuote).toBe('Kubernetes operations');
  });
});

describe('deriveInterviewRunStatus (the single flagged-policy site)', () => {
  it('flags only an ok run that failed a tripwire; non-ok passes through', () => {
    expect(deriveInterviewRunStatus('ok', true)).toBe('flagged');
    expect(deriveInterviewRunStatus('ok', false)).toBe('ok');
    expect(deriveInterviewRunStatus('schema_failed', true)).toBe('schema_failed');
    expect(deriveInterviewRunStatus('refusal', false)).toBe('refusal');
  });
});

describe('persistDraftingOutcome', () => {
  function questionsFor(
    requirementId: string,
    evidenceLinkId: string,
    gapId: string,
  ): InterviewQuestionInsert[] {
    return [
      {
        requirementId,
        kind: 'technical',
        question: 'How would you operate a fictional Kubernetes cluster?',
        points: [
          {
            type: 'gap_disclosure',
            gapId,
            text: 'Be upfront: cluster operations is a genuine gap; the learning plan covers it.',
          },
          {
            type: 'evidence',
            evidenceLinkId,
            text: 'Speak from the fictional cluster lab the profile quote shows.',
          },
        ],
      },
      {
        requirementId,
        kind: 'behavioral',
        question: 'Tell me about learning an operational skill under pressure.',
        points: [],
      },
    ];
  }

  it('ok + tripwire-clean: runs, prep, questions, and typed points commit in one transaction', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    const [link] = await interviewRepo.findEvidenceForReport(user.id, report.id);
    const outcome = await interviewRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      questionsFor(requirements[0]!.id, link!.evidenceLinkId, gaps[0]!.id),
    );
    expect(outcome.prepCreated).toBe(true);
    expect(outcome.conflicted).toBe(false);
    expect(outcome.runs[0]!.status).toBe('ok');

    const read = await interviewRepo.findPrepForReport(user.id, report.id);
    expect(read).toBeDefined();
    // R2 run-selection: the prep's run IS its drafting run.
    expect(read!.run.id).toBe(outcome.runs[0]!.id);
    expect(read!.questions).toHaveLength(2);
    expect(read!.questions.map((q) => q.question.position)).toEqual([0, 1]);
    expect(read!.questions[0]!.requirementText).toBe('Kubernetes cluster operations');
    // Points in array order with the display joins: disclosure first
    // (position 0) carrying the LIVE gap classification, evidence second.
    const points = read!.questions[0]!.points;
    expect(points.map((p) => p.point.position)).toEqual([0, 1]);
    expect(points[0]!.point.type).toBe('gap_disclosure');
    expect(points[0]!.gapClassification).toBe('genuine_gap');
    expect(points[0]!.evidenceStrength).toBeNull();
    expect(points[1]!.point.type).toBe('evidence');
    expect(points[1]!.evidenceStrength).toBe('adjacent');
    expect(points[1]!.evidencePostingQuote).toBe('Kubernetes operations');
    expect(points[1]!.gapClassification).toBeNull();
  });

  it('a tripwire failure flags the final run and writes NO prep (nothing reaches the DB)', async () => {
    const { user, report } = await seedReportChain();
    const outcome = await interviewRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      true,
      undefined,
    );
    expect(outcome.runs[0]!.status).toBe('flagged');
    expect(outcome.prepCreated).toBe(false);
    expect(await interviewRepo.findPrepForReport(user.id, report.id)).toBeUndefined();
    // The flagged run is still the failure display.
    const latest = await interviewRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(outcome.runs[0]!.id);
  });

  it('a non-ok terminal run records without a prep; providing questions then throws', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    const [link] = await interviewRepo.findEvidenceForReport(user.id, report.id);
    const outcome = await interviewRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'schema_failed' }), runInsert({ status: 'schema_failed', attempt: 2 })],
      false,
      undefined,
    );
    expect(outcome.runs.map((run) => run.status)).toEqual(['schema_failed', 'schema_failed']);
    expect(outcome.prepCreated).toBe(false);
    await expect(
      interviewRepo.persistDraftingOutcome(
        user.id,
        report.id,
        [runInsert({ status: 'refusal' })],
        false,
        questionsFor(requirements[0]!.id, link!.evidenceLinkId, gaps[0]!.id),
      ),
    ).rejects.toThrowError(/ok, tripwire-clean/);
  });

  it('a lost concurrent race commits the runs and reports conflicted (pin-to-report)', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    const [link] = await interviewRepo.findEvidenceForReport(user.id, report.id);
    const questions = questionsFor(requirements[0]!.id, link!.evidenceLinkId, gaps[0]!.id);
    const first = await interviewRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      questions,
    );
    const second = await interviewRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ createdAt: new Date('2026-07-25T10:01:00.000Z') })],
      false,
      questions,
    );
    expect(first.prepCreated).toBe(true);
    expect(second.prepCreated).toBe(false);
    expect(second.conflicted).toBe(true);
    // Both wire calls are recorded (honest telemetry)...
    const latest = await interviewRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(second.runs[0]!.id);
    // ...and the surviving prep is still the first one's.
    const read = await interviewRepo.findPrepForReport(user.id, report.id);
    expect(read!.run.id).toBe(first.runs[0]!.id);
  });
});

describe('markPrepReviewed', () => {
  it('one-shot CAS: reviewed, then already_reviewed, and not_found for a foreign id', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    const [link] = await interviewRepo.findEvidenceForReport(user.id, report.id);
    await interviewRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      {
        requirementId: requirements[0]!.id,
        kind: 'technical',
        question: 'Fictional question?',
        points: [
          { type: 'evidence', evidenceLinkId: link!.evidenceLinkId, text: 'fictional point' },
          { type: 'gap_disclosure', gapId: gaps[0]!.id, text: 'fictional disclosure' },
        ],
      },
    ]);
    const read = await interviewRepo.findPrepForReport(user.id, report.id);
    const prepId = read!.prep.id;

    const reviewed = await interviewRepo.markPrepReviewed(user.id, prepId, 'Solid set.');
    expect(reviewed.kind).toBe('reviewed');
    if (reviewed.kind === 'reviewed') {
      expect(reviewed.prep.reviewStatus).toBe('reviewed');
      expect(reviewed.prep.notes).toBe('Solid set.');
    }
    expect((await interviewRepo.markPrepReviewed(user.id, prepId, null)).kind).toBe(
      'already_reviewed',
    );
    expect(
      (await interviewRepo.markPrepReviewed(user.id, '00000000-0000-4000-8000-000000000000', null))
        .kind,
    ).toBe('not_found');
    expect((await interviewRepo.findPrepMeta(user.id, prepId))?.reviewStatus).toBe('reviewed');
  });
});

describe('LearningPlanPointerRead (read-time wire pointer)', () => {
  it('groups plans by cited gap id, meta only; uncited gaps are absent; empty input short-circuits', async () => {
    const { user, gaps } = await seedReportChain();
    const gapId = gaps[0]!.id;
    const persisted = await learningRepo.persistDraftingOutcome(
      user.id,
      [
        {
          promptId: 'learning-plan@v1',
          provider: 'mock',
          model: 'mock-sonnet',
          rawResponse: { mock: true },
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          latencyMs: 5,
          attempt: 1,
          status: 'ok',
          createdAt: new Date('2026-07-25T11:00:00.000Z'),
        },
      ],
      false,
      {
        title: 'Close the fictional Kubernetes gap',
        gaps: [{ gapId, focus: 'Build a fictional cluster lab.', priority: 'high' }],
      },
    );
    expect(persisted.planCreated).toBe(true);

    const grouped = await learningRepo.listPlanPointersByGapIds(user.id, [
      gapId,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(grouped.get(gapId)).toEqual([
      { id: persisted.planId, title: 'Close the fictional Kubernetes gap' },
    ]);
    expect(grouped.has('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect((await learningRepo.listPlanPointersByGapIds(user.id, [])).size).toBe(0);
  });
});

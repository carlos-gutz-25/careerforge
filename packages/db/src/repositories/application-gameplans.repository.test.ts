import {
  FIT_DIMENSIONS,
  GAMEPLAN_PHASES,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, truncateAllTables } from '../test/db-test-utils.ts';
import {
  createApplicationGameplansRepository,
  deriveGameplanRunStatus,
  type GameplanArtifactInsert,
  type GameplanRunInsert,
} from './application-gameplans.repository.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository } from './fit-reports.repository.ts';
import { createImprovementPlansRepository } from './improvement-plans.repository.ts';
import { createInterviewPrepsRepository } from './interview-preps.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M7-07 application-gameplan persistence path
// (dockerized Postgres, migration 0021 tables). All fixture data fictional
// (RISKS P-01).

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const planRepo = createImprovementPlansRepository(handle.db);
const interviewRepo = createInterviewPrepsRepository(handle.db);
const gameplanRepo = createApplicationGameplansRepository(handle.db);

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
    email: `gameplan.fictional.${String(seedSequence)}@example.com`,
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

function runInsert(overrides: Partial<GameplanRunInsert> = {}): GameplanRunInsert {
  return {
    promptId: 'application-gameplan@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 3200,
    outputTokens: 1200,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 6000,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    ...overrides,
  };
}

/** A full clean artifact: a summary, all four phase strategies, and one story
 *  citing the given evidence link. */
function artifactFor(evidenceLinkId: string): GameplanArtifactInsert {
  return {
    strategySummary: 'Lead with the fictional cluster lab; be honest about the operations gap.',
    phaseStrategies: {
      apply: 'Tailor the resume to the operations requirement.',
      screen: 'Frame the cluster lab as hands-on evidence.',
      interview: 'Rehearse the STAR story and name the gap plainly.',
      offer: 'Confirm the compensation band before deciding.',
    },
    stories: [
      {
        situation: 'A fictional team needed a resilient cluster.',
        task: 'Stand up the lab and prove the approach.',
        action: 'Built and operated a fictional Kubernetes cluster lab.',
        result: 'Delivered a working demo and documented the runbook.',
        citations: [{ evidenceLinkId }],
      },
    ],
  };
}

/** Seed a full chain: two verified requirements, a gap on the FIRST, evidence on
 *  the first. */
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

describe('deriveGameplanRunStatus (the single flagged-policy site)', () => {
  it('flags only an ok run that failed a tripwire; non-ok passes through', () => {
    expect(deriveGameplanRunStatus('ok', true)).toBe('flagged');
    expect(deriveGameplanRunStatus('ok', false)).toBe('ok');
    expect(deriveGameplanRunStatus('schema_failed', true)).toBe('schema_failed');
    expect(deriveGameplanRunStatus('max_tokens', false)).toBe('max_tokens');
    expect(deriveGameplanRunStatus('refusal', true)).toBe('refusal');
    expect(deriveGameplanRunStatus('error', true)).toBe('error');
  });
});

describe('persistDraftingOutcome', () => {
  it('ok + clean: runs, gameplan, ALL FOUR phase rows, story + citation commit in one tx', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    const outcome = await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      artifactFor(link!.evidenceLinkId),
    );
    expect(outcome.gameplanCreated).toBe(true);
    expect(outcome.conflicted).toBe(false);
    expect(outcome.runs[0]!.status).toBe('ok');

    const read = await gameplanRepo.findGameplanForReport(user.id, report.id);
    expect(read).toBeDefined();
    // R2 run-selection: the gameplan's run IS its drafting run.
    expect(read!.run.id).toBe(outcome.runs[0]!.id);
    // EXACTLY four phase rows, read in canonical GAMEPLAN_PHASES order.
    expect(read!.phaseStrategies.map((row) => row.phase)).toEqual([...GAMEPLAN_PHASES]);
    expect(read!.stories).toHaveLength(1);
    expect(read!.stories[0]!.story.position).toBe(0);
    const citations = read!.stories[0]!.citations;
    expect(citations).toHaveLength(1);
    expect(citations[0]!.citation.position).toBe(0);
    expect(citations[0]!.citation.evidenceLinkId).toBe(link!.evidenceLinkId);
    // Read-time story-requirement derivation fields joined per citation.
    expect(citations[0]!.strength).toBe('adjacent');
    expect(citations[0]!.postingQuote).toBe('Kubernetes operations');
    expect(citations[0]!.requirementText).toBe('Kubernetes cluster operations');
  });

  it('a tripwire failure flags the final run and writes NO gameplan (nothing reaches the DB)', async () => {
    const { user, report } = await seedReportChain();
    const outcome = await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      true,
      undefined,
    );
    expect(outcome.runs[0]!.status).toBe('flagged');
    expect(outcome.gameplanCreated).toBe(false);
    expect(await gameplanRepo.findGameplanForReport(user.id, report.id)).toBeUndefined();
    const counts = await handle.pool.query<{
      gameplans: string;
      phases: string;
      stories: string;
      citations: string;
    }>(
      `select (select count(*) from application_gameplans) as gameplans,
              (select count(*) from gameplan_phase_strategies) as phases,
              (select count(*) from gameplan_stories) as stories,
              (select count(*) from gameplan_story_citations) as citations`,
    );
    expect(counts.rows[0]).toEqual({ gameplans: '0', phases: '0', stories: '0', citations: '0' });
    // The flagged run is still the failure display.
    const latest = await gameplanRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(outcome.runs[0]!.id);
  });

  it('a non-ok terminal run records without a gameplan; providing an artifact then throws', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    const outcome = await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'schema_failed' }), runInsert({ status: 'schema_failed', attempt: 2 })],
      false,
      undefined,
    );
    expect(outcome.runs.map((run) => run.status)).toEqual(['schema_failed', 'schema_failed']);
    expect(outcome.gameplanCreated).toBe(false);
    await expect(
      gameplanRepo.persistDraftingOutcome(
        user.id,
        report.id,
        [runInsert({ status: 'refusal' })],
        false,
        artifactFor(link!.evidenceLinkId),
      ),
    ).rejects.toThrowError(/ok, tripwire-clean/);
  });

  it('a lost concurrent race commits the runs and reports conflicted (pin-to-report)', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    const artifact = artifactFor(link!.evidenceLinkId);
    const first = await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      artifact,
    );
    const second = await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert({ createdAt: new Date('2026-07-25T10:01:00.000Z') })],
      false,
      artifact,
    );
    expect(first.gameplanCreated).toBe(true);
    expect(second.gameplanCreated).toBe(false);
    expect(second.conflicted).toBe(true);
    // Both wire calls are recorded (honest telemetry)...
    const latest = await gameplanRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(second.runs[0]!.id);
    // ...and only ONE gameplan (+ four phase rows) exists.
    const counts = await handle.pool.query<{ gameplans: string; phases: string }>(
      `select (select count(*) from application_gameplans) as gameplans,
              (select count(*) from gameplan_phase_strategies) as phases`,
    );
    expect(counts.rows[0]).toEqual({ gameplans: '1', phases: '4' });
  });
});

describe('reads: user-scoping + ordering', () => {
  it('findGameplanForReport is undefined for a stranger; findRequirements/Evidence stay scoped', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      artifactFor(link!.evidenceLinkId),
    );
    const stranger = await users.create({
      email: 'stranger.fictional@example.com',
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(await gameplanRepo.findGameplanForReport(user.id, report.id)).toBeDefined();
    expect(await gameplanRepo.findGameplanForReport(stranger.id, report.id)).toBeUndefined();
    expect(await gameplanRepo.findEvidenceForReport(stranger.id, report.id)).toHaveLength(0);
    expect(await gameplanRepo.findRequirementsForReport(stranger.id, report.id)).toHaveLength(0);
  });

  it('findRequirementsForReport returns (position, id) order with the gap LEFT JOIN', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    const rows = await gameplanRepo.findRequirementsForReport(user.id, report.id);
    expect(rows.map((row) => row.text)).toEqual(['Kubernetes cluster operations', 'TypeScript']);
    expect(rows[0]!.gapId).toBe(gaps[0]!.id);
    expect(rows[0]!.gapClassification).toBe('genuine_gap');
    expect(rows[1]!.gapId).toBeNull();
    expect(requirements.length).toBe(2);
  });
});

describe('findImprovementPlanGuidance (reviewed-only law)', () => {
  async function seedReviewedPlan(userId: string, fitReportId: string, gapId: string) {
    await planRepo.persistDraftingOutcome(
      userId,
      fitReportId,
      [
        {
          promptId: 'improvement-plan@v1',
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
      [{ gapId, action: 'Build a fictional cluster lab.', priority: 'high' }],
    );
    const plan = await planRepo.findPlanForReport(userId, fitReportId);
    return plan!.plan.id;
  }

  it('returns items only when the plan is REVIEWED; draft => undefined', async () => {
    const { user, report, gaps } = await seedReportChain();
    const planId = await seedReviewedPlan(user.id, report.id, gaps[0]!.id);
    // Draft plan: no guidance yet.
    expect(await gameplanRepo.findImprovementPlanGuidance(user.id, report.id)).toBeUndefined();
    await planRepo.markPlanReviewed(user.id, planId, null);
    const guidance = await gameplanRepo.findImprovementPlanGuidance(user.id, report.id);
    expect(guidance).toEqual({
      items: [{ action: 'Build a fictional cluster lab.', priority: 'high' }],
    });
  });

  it('undefined when the report has no plan', async () => {
    const { user, report } = await seedReportChain();
    expect(await gameplanRepo.findImprovementPlanGuidance(user.id, report.id)).toBeUndefined();
  });
});

describe('markGameplanReviewed (one-shot CAS)', () => {
  it('reviewed, then already_reviewed, and not_found for a foreign id', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      artifactFor(link!.evidenceLinkId),
    );
    const read = await gameplanRepo.findGameplanForReport(user.id, report.id);
    const gameplanId = read!.gameplan.id;

    const reviewed = await gameplanRepo.markGameplanReviewed(user.id, gameplanId, 'Solid plan.');
    expect(reviewed.kind).toBe('reviewed');
    if (reviewed.kind === 'reviewed') {
      expect(reviewed.gameplan.reviewStatus).toBe('reviewed');
      expect(reviewed.gameplan.notes).toBe('Solid plan.');
    }
    expect((await gameplanRepo.markGameplanReviewed(user.id, gameplanId, null)).kind).toBe(
      'already_reviewed',
    );
    expect(
      (
        await gameplanRepo.markGameplanReviewed(
          user.id,
          '00000000-0000-4000-8000-000000000000',
          null,
        )
      ).kind,
    ).toBe('not_found');
    expect((await gameplanRepo.findGameplanMeta(user.id, gameplanId))?.reviewStatus).toBe(
      'reviewed',
    );
  });
});

describe('checks upsert + read', () => {
  it('upsertCheck inserts then updates the same key; findChecksForGameplan returns the rows', async () => {
    const { user, report } = await seedReportChain();
    const [link] = await gameplanRepo.findEvidenceForReport(user.id, report.id);
    await gameplanRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      artifactFor(link!.evidenceLinkId),
    );
    const gameplanId = (await gameplanRepo.findGameplanForReport(user.id, report.id))!.gameplan.id;

    const inserted = await gameplanRepo.upsertCheck(user.id, gameplanId, 'apply-submit', true);
    expect(inserted.done).toBe(true);
    // Same key again toggles the existing row (no duplicate).
    const updated = await gameplanRepo.upsertCheck(user.id, gameplanId, 'apply-submit', false);
    expect(updated.id).toBe(inserted.id);
    expect(updated.done).toBe(false);
    await gameplanRepo.upsertCheck(user.id, gameplanId, 'offer-references', true);

    const rows = await gameplanRepo.findChecksForGameplan(user.id, gameplanId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.checkKey))).toEqual(
      new Set(['apply-submit', 'offer-references']),
    );
  });
});

describe('findStageChangeEventsForPosting (timeline input)', () => {
  it('returns only stage_change events, chronologically; excludes notes and foreign postings', async () => {
    const { user, posting } = await seedUserAndPosting();
    const appRes = await handle.pool.query<{ id: string }>(
      `insert into applications (user_id, posting_id, stage) values ($1, $2, 'interview') returning id`,
      [user.id, posting.id],
    );
    const appId = appRes.rows[0]!.id;
    await handle.pool.query(
      `insert into application_events (user_id, application_id, kind, detail, occurred_on) values
         ($1, $2, 'stage_change', 'applied to screen', '2026-07-22'),
         ($1, $2, 'stage_change', 'considering to applied', '2026-07-20'),
         ($1, $2, 'note', 'a note', '2026-07-21')`,
      [user.id, appId],
    );
    const rows = await gameplanRepo.findStageChangeEventsForPosting(user.id, posting.id);
    expect(rows.map((row) => row.detail)).toEqual(['considering to applied', 'applied to screen']);
    // Foreign user sees nothing.
    const stranger = await users.create({
      email: 'stranger.stage.fictional@example.com',
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    expect(
      await gameplanRepo.findStageChangeEventsForPosting(stranger.id, posting.id),
    ).toHaveLength(0);
  });
});

describe('findSiblingPointers (meta-only)', () => {
  it('returns null pointers when no siblings exist, and meta pointers when they do', async () => {
    const { user, report, requirements, gaps } = await seedReportChain();
    // No siblings yet.
    expect(await gameplanRepo.findSiblingPointers(user.id, report.id)).toEqual({
      improvementPlan: null,
      interviewPrep: null,
    });

    // Seed an improvement plan (draft) and an interview prep (draft).
    await planRepo.persistDraftingOutcome(
      user.id,
      report.id,
      [
        {
          promptId: 'improvement-plan@v1',
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
      [{ gapId: gaps[0]!.id, action: 'Fictional action.', priority: 'high' }],
    );
    const [link] = await interviewRepo.findEvidenceForReport(user.id, report.id);
    await interviewRepo.persistDraftingOutcome(user.id, report.id, [runInsert()], false, [
      {
        requirementId: requirements[0]!.id,
        kind: 'technical',
        question: 'Fictional question?',
        points: [{ type: 'evidence', evidenceLinkId: link!.evidenceLinkId, text: 'fictional' }],
      },
    ]);

    const planRow = await planRepo.findPlanForReport(user.id, report.id);
    const pointers = await gameplanRepo.findSiblingPointers(user.id, report.id);
    expect(pointers.improvementPlan?.id).toBe(planRow!.plan.id);
    expect(pointers.improvementPlan?.reviewStatus).toBe('draft');
    expect(pointers.interviewPrep?.reviewStatus).toBe('draft');
    expect(pointers.interviewPrep?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

import {
  FIT_DIMENSIONS,
  type EvidenceLink,
  type FitReportData,
  type GapAssignment,
  type SearchCriteriaData,
} from '@careerforge/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { createExtractionsRepository } from './extractions.repository.ts';
import { createFitReportsRepository } from './fit-reports.repository.ts';
import { createPostingsRepository } from './postings.repository.ts';
import { createProfileRepository } from './profile.repository.ts';
import {
  createResumeVariantsRepository,
  deriveResumeRunStatus,
  type ResumeVariantEntryInsert,
  type ResumeVariantInsert,
  type ResumeVariantRunInsert,
} from './resume-variants.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M2-10 resume-variant persistence path (dockerized
// Postgres, migration 0008). All fixture data fictional (RISKS P-01) — the
// Alex Rivera persona.

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const variantsRepo = createResumeVariantsRepository(handle.db);

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
    email: `variants.fictional.${String(seedSequence)}@example.com`,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  const { posting } = await postings.ingest(user.id, {
    rawText: 'Fictional Gizmo Works hiring. Requirements: 5+ years TypeScript. Kubernetes.',
    contentHash: String(seedSequence).padEnd(64, 'f').slice(0, 64),
    company: 'Fictional Gizmo Works',
    title: 'Senior Engineer',
    sourceNote: null,
  });
  return { user, posting };
}

async function extractRun(userId: string, postingId: string, texts: string[]) {
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
        createdAt: new Date('2026-07-23T09:00:00.000Z'),
      },
    ],
    texts.map((text) => ({
      kind: 'must_have' as const,
      category: 'other' as const,
      text,
      sourceQuote: `quote: ${text}`,
      confidence: 0.9,
      quoteVerified: true,
    })),
  );
  const run = outcome.runs[0];
  if (!run) throw new Error('seed produced no run');
  return { run, requirements: outcome.requirements };
}

function reportData(evidence: EvidenceLink[] = []): FitReportData {
  return {
    verdict: 'scored',
    exclusions: [],
    subScores: FIT_DIMENSIONS.map((dimension, index) => ({
      dimension,
      score: 0.5,
      rationale: `fictional ${dimension} rationale`,
      // Hang all seeded evidence off the first dimension.
      evidence: index === 0 ? evidence : [],
    })),
    unscoredRequirements: [],
    forcedLowestPriority: { applied: false, matchedSlugs: [] },
    inputFlagged: false,
  };
}

function assignmentsFor(rows: readonly { id: string }[]): GapAssignment[] {
  return rows.map((row) => ({
    requirementId: row.id,
    classification: 'genuine_gap' as const,
    rationale: 'No named-skill evidence.',
  }));
}

/** Seed a full user → posting → extraction → report → gaps chain plus the
 *  user's profile rows, and return everything a variant needs. */
async function seedReportWithGaps(texts = ['Kubernetes cluster operations', 'TypeScript']) {
  const { user, posting } = await seedUserAndPosting();
  const { run, requirements } = await extractRun(user.id, posting.id, texts);
  await profileRepo.syncProfile(user.id, {
    skills: [
      {
        name: 'TypeScript',
        category: 'language',
        level: 'expert',
        years: 8,
        lastUsed: '2026-01-01',
      },
    ],
    experiences: [
      {
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
        endDate: null,
        bullets: [],
      },
    ],
    projects: [
      {
        name: 'Reporting Dashboard Modernization',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary: 'A fictional dashboard.',
      },
    ],
  });
  const profile = await profileRepo.getProfile(user.id);
  const outcome = await fitRepo.persistFitReport(
    user.id,
    posting.id,
    run.id,
    reportData(),
    CRITERIA,
    assignmentsFor(requirements),
  );
  const skill = profile.skills[0];
  const experience = profile.experiences[0];
  const project = profile.projects[0];
  if (!skill || !experience || !project) throw new Error('seed profile incomplete');
  return {
    user,
    posting,
    report: outcome.report,
    gaps: outcome.gaps,
    profile: { skill, experience, project },
  };
}

function runInsert(overrides: Partial<ResumeVariantRunInsert> = {}): ResumeVariantRunInsert {
  return {
    promptId: 'resume-tailoring@v1',
    provider: 'mock',
    model: 'mock-sonnet',
    rawResponse: { mock: true },
    inputTokens: 2600,
    outputTokens: 640,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 4800,
    attempt: 1,
    status: 'ok',
    createdAt: new Date('2026-07-23T10:00:00.000Z'),
    ...overrides,
  };
}

/** A three-entry variant (skill/experience/project) referencing the seeded
 *  profile rows; the skill cites gapA and the project cites gapB. */
function variantInsert(
  profile: { skill: { id: string }; experience: { id: string }; project: { id: string } },
  gapAId: string,
  gapBId: string,
): ResumeVariantInsert {
  const entries: ResumeVariantEntryInsert[] = [
    {
      section: 'skill',
      position: 0,
      profileSkillId: profile.skill.id,
      profileProjectId: null,
      profileExperienceId: null,
      label: 'TypeScript',
      detail: 'expert · 8 yrs · last used 2026',
      emphasis: 'lead',
      reason: 'Emphasized in light of the TypeScript requirement.',
      citationGapIds: [gapAId],
    },
    {
      section: 'experience',
      position: 0,
      profileSkillId: null,
      profileProjectId: null,
      profileExperienceId: profile.experience.id,
      label: 'Acme Analytics Co. — Senior Software Engineer',
      detail: '2020 - present',
      emphasis: null,
      reason: null,
      citationGapIds: [],
    },
    {
      section: 'project',
      position: 0,
      profileSkillId: null,
      profileProjectId: profile.project.id,
      profileExperienceId: null,
      label: 'Reporting Dashboard Modernization',
      detail: 'professional',
      emphasis: 'highlight',
      reason: 'Emphasized in light of the Kubernetes requirement.',
      citationGapIds: [gapBId],
    },
  ];
  return { renderedMarkdown: '# Tailored resume variant (draft)\n\nfictional body\n', entries };
}

describe('deriveResumeRunStatus (single policy site)', () => {
  it('flags only an ok run with an invalid spec; non-ok passes through', () => {
    expect(deriveResumeRunStatus('ok', true)).toBe('flagged');
    expect(deriveResumeRunStatus('ok', false)).toBe('ok');
    expect(deriveResumeRunStatus('schema_failed', true)).toBe('schema_failed');
    expect(deriveResumeRunStatus('refusal', false)).toBe('refusal');
  });
});

describe('persistTailoringOutcome', () => {
  it('one transaction: runs + variant + entries + citations; findVariantForReport joins live gap fields', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    const outcome = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    expect(outcome.variantCreated).toBe(true);
    expect(outcome.conflicted).toBe(false);
    expect(outcome.runs).toHaveLength(1);
    expect(outcome.runs[0]?.status).toBe('ok');

    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    expect(stored).toBeDefined();
    expect(stored?.variant.reviewStatus).toBe('draft');
    expect(stored?.variant.tailoringRunId).toBe(outcome.runs[0]?.id);
    expect(stored?.variant.renderedMarkdown).toContain('# Tailored resume variant (draft)');
    // R2: the variant's run is the ok call it was parsed from (via FK).
    expect(stored?.run.id).toBe(outcome.runs[0]?.id);
    // Entries are ordered (section, position, id) — alphabetical section.
    expect(stored?.entries.map((row) => row.entry.section)).toEqual([
      'experience',
      'project',
      'skill',
    ]);
    // The experience carries no emphasis/reason and no citations (standard).
    const experienceEntry = stored?.entries.find((row) => row.entry.section === 'experience');
    expect(experienceEntry?.entry.emphasis).toBeNull();
    expect(experienceEntry?.entry.reason).toBeNull();
    expect(experienceEntry?.citations).toEqual([]);
    // The skill cites gapA with its live joined requirement fields.
    const skillEntry = stored?.entries.find((row) => row.entry.section === 'skill');
    expect(skillEntry?.entry.emphasis).toBe('lead');
    expect(skillEntry?.entry.profileSkillId).toBe(profile.skill.id);
    expect(skillEntry?.citations).toHaveLength(1);
    expect(skillEntry?.citations[0]?.citation.gapId).toBe(gapA.id);
    expect(skillEntry?.citations[0]?.gapClassification).toBe('genuine_gap');
    expect(skillEntry?.citations[0]?.requirementText).toBe('Kubernetes cluster operations');
    expect(skillEntry?.citations[0]?.requirementKind).toBe('must_have');
    // The project cites gapB.
    const projectEntry = stored?.entries.find((row) => row.entry.section === 'project');
    expect(projectEntry?.citations[0]?.requirementText).toBe('TypeScript');
  });

  it('retry pair: schema_failed attempt 1 + ok attempt 2 = two audit rows, one variant', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    const outcome = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [
        runInsert({ status: 'schema_failed', attempt: 1 }),
        runInsert({ attempt: 2, createdAt: new Date('2026-07-23T10:00:10.000Z') }),
      ],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    expect(outcome.runs.map((row) => row.status)).toEqual(['schema_failed', 'ok']);
    expect(outcome.variantCreated).toBe(true);

    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    expect(stored?.run.attempt).toBe(2);
  });

  it('spec invalid: final run stored flagged, NO variant row, latest-run read serves it', async () => {
    const { user, report } = await seedReportWithGaps();

    const outcome = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      true,
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('flagged');
    expect(outcome.variantCreated).toBe(false);

    expect(await variantsRepo.findVariantForReport(user.id, report.id)).toBeUndefined();
    const latest = await variantsRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.status).toBe('flagged');
  });

  it('non-ok terminal (no variant): runs recorded, no variant', async () => {
    const { user, report } = await seedReportWithGaps();
    const outcome = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'refusal' })],
      false,
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('refusal');
    expect(outcome.variantCreated).toBe(false);
    expect(await variantsRepo.findVariantForReport(user.id, report.id)).toBeUndefined();
  });

  it('UNIQUE race: second persist commits its run but reports conflicted, first variant stands', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    const first = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    const second = await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert({ createdAt: new Date('2026-07-23T10:00:20.000Z') })],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    expect(first.variantCreated).toBe(true);
    expect(second.variantCreated).toBe(false);
    expect(second.conflicted).toBe(true);

    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    expect(stored?.variant.tailoringRunId).toBe(first.runs[0]?.id);
    // Honest telemetry: BOTH wire calls are in the audit table.
    const latest = await variantsRepo.findLatestRunForReport(user.id, report.id);
    expect(latest?.id).toBe(second.runs[0]?.id);
  });

  it('rejects an empty run list and a variant on a non-ok final run', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');

    await expect(
      variantsRepo.persistTailoringOutcome(user.id, report.id, [], false, undefined),
    ).rejects.toThrow('at least one run');
    await expect(
      variantsRepo.persistTailoringOutcome(
        user.id,
        report.id,
        [runInsert({ status: 'schema_failed' })],
        false,
        variantInsert(profile, gapA.id, gapB.id),
      ),
    ).rejects.toThrow('ok, spec-valid');
  });
});

describe('the snapshot pin (mutable-profile hole)', () => {
  it('a profile re-import that removes the rows SET NULLs the FKs but the label/detail/rendered_markdown survive', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');
    await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );

    // Re-import an empty profile: the full-sync deletes every absent row.
    await profileRepo.syncProfile(user.id, { skills: [], experiences: [], projects: [] });

    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    expect(stored).toBeDefined();
    // FKs went NULL...
    for (const row of stored?.entries ?? []) {
      expect(row.entry.profileSkillId).toBeNull();
      expect(row.entry.profileProjectId).toBeNull();
      expect(row.entry.profileExperienceId).toBeNull();
    }
    // ...but the durable snapshots survive, byte-for-byte.
    const skillEntry = stored?.entries.find((row) => row.entry.section === 'skill');
    expect(skillEntry?.entry.label).toBe('TypeScript');
    expect(skillEntry?.entry.detail).toBe('expert · 8 yrs · last used 2026');
    expect(stored?.variant.renderedMarkdown).toContain('# Tailored resume variant (draft)');
  });
});

describe('the report-family cascade (both-route trace)', () => {
  it('deleting the fit report removes the variant, entries, citations, and runs', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');
    await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );

    await handle.pool.query('delete from fit_reports where id = $1', [report.id]);

    const counts = await handle.pool.query<{
      variants: string;
      entries: string;
      citations: string;
      runs: string;
    }>(
      `select (select count(*) from resume_variants) as variants,
              (select count(*) from resume_variant_entries) as entries,
              (select count(*) from resume_variant_citations) as citations,
              (select count(*) from resume_variant_runs) as runs`,
    );
    expect(counts.rows[0]).toEqual({ variants: '0', entries: '0', citations: '0', runs: '0' });
  });
});

describe('review + anchor reads', () => {
  it('markVariantReviewed reviews once, 409s the second, 404s the unknown and the foreign', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');
    await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    if (!stored) throw new Error('variant missing after persist');

    const first = await variantsRepo.markVariantReviewed(
      user.id,
      stored.variant.id,
      'Looks honest.',
    );
    expect(first.kind).toBe('reviewed');
    if (first.kind === 'reviewed') {
      expect(first.variant.reviewStatus).toBe('reviewed');
      expect(first.variant.notes).toBe('Looks honest.');
    }

    expect((await variantsRepo.markVariantReviewed(user.id, stored.variant.id, null)).kind).toBe(
      'already_reviewed',
    );
    expect(
      (
        await variantsRepo.markVariantReviewed(
          user.id,
          '99999999-9999-4999-8999-999999999999',
          null,
        )
      ).kind,
    ).toBe('not_found');

    const { user: stranger } = await seedReportWithGaps();
    expect(
      (await variantsRepo.markVariantReviewed(stranger.id, stored.variant.id, null)).kind,
    ).toBe('not_found');
  });

  it('findVariantById and findReportById are user-scoped', async () => {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');
    await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    if (!stored) throw new Error('variant missing after persist');

    expect((await variantsRepo.findVariantById(user.id, stored.variant.id))?.id).toBe(
      stored.variant.id,
    );
    expect((await variantsRepo.findReportById(user.id, report.id))?.id).toBe(report.id);
    const { user: stranger } = await seedReportWithGaps();
    expect(await variantsRepo.findVariantById(stranger.id, stored.variant.id)).toBeUndefined();
    expect(await variantsRepo.findReportById(stranger.id, report.id)).toBeUndefined();
  });
});

// The DB enforces the entry-level invariants by itself — raw SQL through the
// pool on purpose, against a repository-seeded valid variant, so nothing from
// the Drizzle layer can mask a missing constraint. Real profile ids are used
// so a CHECK failure is never masked by an FK (23503) violation.
describe('resume_variant_entries constraints (integration)', () => {
  const rejectsWith = (code: string) => (error: unknown) => pgErrorCode(error) === code;

  async function seedVariantWithEntry() {
    const { user, report, gaps, profile } = await seedReportWithGaps();
    const [gapA, gapB] = gaps;
    if (!gapA || !gapB) throw new Error('seed produced fewer than 2 gaps');
    await variantsRepo.persistTailoringOutcome(
      user.id,
      report.id,
      [runInsert()],
      false,
      variantInsert(profile, gapA.id, gapB.id),
    );
    const stored = await variantsRepo.findVariantForReport(user.id, report.id);
    if (!stored) throw new Error('variant missing after persist');
    const skillEntry = stored.entries.find((row) => row.entry.section === 'skill');
    if (!skillEntry) throw new Error('skill entry missing');
    return { user, variant: stored.variant, skillEntry: skillEntry.entry, profile, gapA };
  }

  it('CHECK rejects an emphasis without a reason (and vice versa)', async () => {
    const { user, variant, profile } = await seedVariantWithEntry();
    await expect(
      handle.pool.query(
        `insert into resume_variant_entries
           (user_id, resume_variant_id, section, position, profile_skill_id, label, emphasis, reason)
         values ($1, $2, 'skill', 10, $3, 'TypeScript', 'lead', null)`,
        [user.id, variant.id, profile.skill.id],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (emphasis without reason)');
    await expect(
      handle.pool.query(
        `insert into resume_variant_entries
           (user_id, resume_variant_id, section, position, profile_skill_id, label, emphasis, reason)
         values ($1, $2, 'skill', 11, $3, 'TypeScript', null, 'orphan reason')`,
        [user.id, variant.id, profile.skill.id],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (reason without emphasis)');
  });

  it('CHECK rejects a non-matching profile FK for the section (a skill row naming a project)', async () => {
    const { user, variant, profile } = await seedVariantWithEntry();
    await expect(
      handle.pool.query(
        `insert into resume_variant_entries
           (user_id, resume_variant_id, section, position, profile_skill_id, profile_project_id, label)
         values ($1, $2, 'skill', 12, $3, $4, 'TypeScript')`,
        [user.id, variant.id, profile.skill.id, profile.project.id],
      ),
    ).rejects.toSatisfy(rejectsWith('23514'), 'expected check_violation (section-fk)');
  });

  it('UNIQUE rejects a duplicate (variant, section, position) render slot', async () => {
    const { user, variant, profile } = await seedVariantWithEntry();
    // The seed already put a skill at position 0.
    await expect(
      handle.pool.query(
        `insert into resume_variant_entries
           (user_id, resume_variant_id, section, position, profile_skill_id, label)
         values ($1, $2, 'skill', 0, $3, 'Duplicate slot')`,
        [user.id, variant.id, profile.skill.id],
      ),
    ).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation (position)');
  });

  it('UNIQUE rejects a duplicate (entry, gap) citation', async () => {
    const { user, skillEntry, gapA } = await seedVariantWithEntry();
    // The seed skill entry already cites gapA at position 0.
    await expect(
      handle.pool.query(
        `insert into resume_variant_citations
           (user_id, resume_variant_entry_id, gap_id, position)
         values ($1, $2, $3, 1)`,
        [user.id, skillEntry.id, gapA.id],
      ),
    ).rejects.toSatisfy(rejectsWith('23505'), 'expected unique_violation (entry, gap)');
  });
});

describe('findTailoringEvidenceForReport (the entity-FK-ids delta)', () => {
  it('returns evidence rows carrying the linked profile-entity FK ids', async () => {
    const { user, posting } = await seedUserAndPosting();
    const { run, requirements } = await extractRun(user.id, posting.id, ['Kubernetes operations']);
    await profileRepo.syncProfile(user.id, {
      skills: [],
      experiences: [
        {
          company: 'Acme Analytics Co.',
          title: 'Senior Software Engineer',
          startDate: '2020-03-01',
          endDate: null,
          bullets: [],
        },
      ],
      projects: [],
    });
    const profile = await profileRepo.getProfile(user.id);
    const experience = profile.experiences[0];
    const requirement = requirements[0];
    if (!experience || !requirement) throw new Error('seed incomplete');

    // Adjacent evidence: no named skill, grounded in an experience.
    const evidence: EvidenceLink[] = [
      {
        requirementId: requirement.id,
        profileSkillId: null,
        profileProjectId: null,
        profileExperienceId: experience.id,
        postingQuote: 'Kubernetes operations',
        profileQuote: 'Ran fictional clusters at Acme.',
        strength: 'adjacent',
      },
    ];
    const outcome = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      reportData(evidence),
      CRITERIA,
      assignmentsFor(requirements),
    );

    const rows = await variantsRepo.findTailoringEvidenceForReport(user.id, outcome.report.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.profileExperienceId).toBe(experience.id);
    expect(rows[0]?.profileSkillId).toBeNull();
    expect(rows[0]?.profileProjectId).toBeNull();
    expect(rows[0]?.strength).toBe('adjacent');
    expect(rows[0]?.requirementId).toBe(requirement.id);
  });
});

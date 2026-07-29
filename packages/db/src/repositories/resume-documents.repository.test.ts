import {
  FIT_DIMENSIONS,
  type CanonicalResumeDoc,
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
  createResumeDocumentsRepository,
  deriveComposeRunStatus,
  type ComposeClaimInsert,
  type ComposeDocumentInsert,
  type ComposeInputs,
  type ComposeRunInsert,
} from './resume-documents.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Integration tests for the M6-04 compose-document persistence path (dockerized
// Postgres, migration 0019). All fixture data fictional (RISKS P-01) - the Robin
// Vale persona.

const handle = createTestDb();
const users = createUsersRepository(handle.db);
const postings = createPostingsRepository(handle.db);
const extractions = createExtractionsRepository(handle.db);
const fitRepo = createFitReportsRepository(handle.db);
const profileRepo = createProfileRepository(handle.db);
const docsRepo = createResumeDocumentsRepository(handle.db);

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
    email: `compose.fictional.${String(seedSequence)}@example.com`,
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
    evaluator: 'skill_evidence' as const,
    confidence: null,
    rationale: 'No named-skill evidence.',
  }));
}

/** Seed a user + posting + extraction + report + gaps AND a full profile
 *  (contact w/ links, skills, an experience w/ a bullet, a professional project
 *  w/ a description, a personal project WITHOUT a description, a summary block,
 *  and an education entry). Returns the report and the server-derived inputs. */
async function seedReportWithFullProfile(): Promise<{
  user: { id: string };
  report: { id: string };
  gaps: readonly { id: string }[];
  inputs: ComposeInputs;
}> {
  const { user, posting } = await seedUserAndPosting();
  const { run, requirements } = await extractRun(user.id, posting.id, [
    'Kubernetes cluster operations',
    'TypeScript',
  ]);
  await profileRepo.syncProfile(user.id, {
    contact: {
      fullName: 'Robin Vale',
      headline: 'Senior Software Engineer',
      phone: null,
      email: 'robin@example.com',
      location: 'Rivertown',
      links: [{ label: 'GitHub', url: 'https://github.example/robinvale' }],
    },
    summaries: [{ text: 'Full-stack engineer with a fictional focus on billing systems.' }],
    education: [
      {
        institution: 'Rivertown University',
        credential: 'BS Computer Science',
        startYear: 2012,
        endYear: 2016,
      },
    ],
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
        bullets: ['Built and shipped the billing service, cutting invoice latency.'],
      },
    ],
    projects: [
      {
        name: 'Reporting Dashboard Modernization',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary: 'A fictional dashboard modernization with real-time widgets.',
      },
      // No description -> excluded from compose inputs (no citable prose).
      { name: 'Weekend Synth', company: null, provenance: 'personal', summary: null },
    ],
  });
  const outcome = await fitRepo.persistFitReport(
    user.id,
    posting.id,
    run.id,
    reportData(),
    CRITERIA,
    assignmentsFor(requirements),
  );
  const inputs = await docsRepo.getComposeInputs(user.id, outcome.report.id);
  return { user, report: outcome.report, gaps: outcome.gaps, inputs };
}

function runInsert(overrides: Partial<ComposeRunInsert> = {}): ComposeRunInsert {
  return {
    promptId: 'resume-compose@v1',
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
    createdAt: new Date('2026-07-27T10:00:00.000Z'),
    ...overrides,
  };
}

/** A three-claim document (summary/experience/project) citing the seeded bullet,
 *  project description, and summary block by their real ids. */
function documentInsert(inputs: ComposeInputs): ComposeDocumentInsert {
  const contact = inputs.contact;
  if (!contact) throw new Error('fixture has no contact');
  const experience = inputs.experiences[0];
  const bullet = experience?.bullets[0];
  const project = inputs.projects[0];
  const summary = inputs.summaries[0];
  if (!experience || !bullet || !project || !summary) throw new Error('fixture profile incomplete');

  const claims: ComposeClaimInsert[] = [
    {
      section: 'summary',
      experienceId: null,
      projectId: null,
      text: 'Full-stack engineer focused on billing systems.',
      citations: [
        {
          sourceKind: 'summary',
          sourceText: summary.text,
          experienceBulletId: null,
          masteryEvidenceId: null,
          projectId: null,
          summaryId: summary.summaryId,
        },
      ],
    },
    {
      section: 'experience',
      experienceId: experience.experienceId,
      projectId: null,
      text: 'Shipped the billing service and cut invoice latency.',
      citations: [
        {
          sourceKind: 'experience_bullet',
          sourceText: bullet.text,
          experienceBulletId: bullet.bulletId,
          masteryEvidenceId: null,
          projectId: null,
          summaryId: null,
        },
      ],
    },
    {
      section: 'project',
      experienceId: null,
      projectId: project.projectId,
      text: 'Modernized the reporting dashboard with real-time widgets.',
      citations: [
        {
          sourceKind: 'project',
          sourceText: project.description,
          experienceBulletId: null,
          masteryEvidenceId: null,
          projectId: project.projectId,
          summaryId: null,
        },
      ],
    },
  ];

  const canonicalDoc: CanonicalResumeDoc = {
    contact: {
      fullName: contact.fullName,
      headline: contact.headline,
      email: contact.email,
      phone: contact.phone,
      location: contact.location,
      links: contact.links,
    },
    education: inputs.education,
    skills: inputs.skills.map((skill) => ({ name: skill.name, level: skill.level })),
    claims: claims.map((claim, position) => ({
      section: claim.section,
      entityRef: claim.section === 'experience' ? 'x1' : claim.section === 'project' ? 'p1' : null,
      entityLabel:
        claim.section === 'experience'
          ? `${experience.company} - ${experience.title}`
          : claim.section === 'project'
            ? project.name
            : null,
      text: claim.text,
      position,
    })),
  };

  return { canonicalDoc, claims };
}

async function countTree(handle2: typeof handle, reportId: string) {
  const docs = await handle2.pool.query<{ n: number }>(
    'select count(*)::int as n from resume_documents where fit_report_id = $1',
    [reportId],
  );
  const claims = await handle2.pool.query<{ n: number }>(
    'select count(*)::int as n from resume_claims c join resume_documents d on d.id = c.resume_document_id where d.fit_report_id = $1',
    [reportId],
  );
  const cites = await handle2.pool.query<{ n: number }>(
    'select count(*)::int as n from resume_claim_citations rc join resume_claims c on c.id = rc.resume_claim_id join resume_documents d on d.id = c.resume_document_id where d.fit_report_id = $1',
    [reportId],
  );
  return {
    documents: docs.rows[0]?.n ?? 0,
    claims: claims.rows[0]?.n ?? 0,
    citations: cites.rows[0]?.n ?? 0,
  };
}

describe('deriveComposeRunStatus (single policy site)', () => {
  it('maps ok+gateViolated->flagged, ok+empty->empty, ok+neither->ok; non-ok passes through', () => {
    expect(deriveComposeRunStatus('ok', true, false)).toBe('flagged');
    expect(deriveComposeRunStatus('ok', false, true)).toBe('empty');
    expect(deriveComposeRunStatus('ok', false, false)).toBe('ok');
    // gate takes precedence over empty when both are set.
    expect(deriveComposeRunStatus('ok', true, true)).toBe('flagged');
    // non-ok wire statuses ignore the policy booleans.
    expect(deriveComposeRunStatus('schema_failed', true, true)).toBe('schema_failed');
    expect(deriveComposeRunStatus('refusal', false, false)).toBe('refusal');
  });
});

describe('getComposeInputs (REQUIRED-1 server-derived read)', () => {
  it('returns the full verified surface; excludes description-less projects; contact null when absent', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();

    expect(inputs.contact?.fullName).toBe('Robin Vale');
    expect(inputs.contact?.links).toEqual([
      { label: 'GitHub', url: 'https://github.example/robinvale' },
    ]);
    expect(inputs.experiences).toHaveLength(1);
    expect(inputs.experiences[0]?.bullets[0]?.text).toContain('billing service');
    // Only the project WITH a description survives (Weekend Synth has none).
    expect(inputs.projects).toHaveLength(1);
    expect(inputs.projects[0]?.name).toBe('Reporting Dashboard Modernization');
    expect(inputs.projects[0]?.description).toContain('dashboard');
    expect(inputs.skills.map((s) => s.name)).toEqual(['TypeScript']);
    expect(inputs.summaries[0]?.text).toContain('billing systems');
    expect(inputs.education[0]).toMatchObject({
      institution: 'Rivertown University',
      credential: 'BS Computer Science',
    });
    // guidance = the report's gaps + their requirements.
    expect(inputs.guidance.gaps.length).toBeGreaterThan(0);
    expect(inputs.guidance.requirements.length).toBeGreaterThan(0);
    expect(inputs.guidance.requirements[0]?.text.length).toBeGreaterThan(0);

    // contact null when no profile_contact row exists for the user.
    const bare = await users.create({ email: 'bare@example.com', passwordHash: 'fake-hash' });
    const bareInputs = await docsRepo.getComposeInputs(bare.id, report.id);
    expect(bareInputs.contact).toBeNull();
    void user;
  });
});

describe('persistComposeOutcome - non-persisting outcomes (flag-the-run-write-nothing)', () => {
  it('records a flagged run and writes NO document/claims/citations', async () => {
    const { user, report } = await seedReportWithFullProfile();
    const outcome = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'flagged' })],
      undefined,
    );
    expect(outcome.document).toBeUndefined();
    expect(outcome.conflicted).toBe(false);
    expect(outcome.runs[0]?.status).toBe('flagged');
    expect(await countTree(handle, report.id)).toEqual({ documents: 0, claims: 0, citations: 0 });
  });

  it('records an empty run (distinct from flagged) and writes nothing', async () => {
    const { user, report } = await seedReportWithFullProfile();
    const outcome = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert({ status: 'empty' })],
      undefined,
    );
    expect(outcome.runs[0]?.status).toBe('empty');
    expect(await countTree(handle, report.id)).toEqual({ documents: 0, claims: 0, citations: 0 });
  });
});

describe('persistComposeOutcome - the persist path', () => {
  it('one transaction: run + document(rev 1) + claims + citations; exactly-one source FK per citation', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    const doc = documentInsert(inputs);
    const outcome = await docsRepo.persistComposeOutcome(user.id, report.id, [runInsert()], doc);

    expect(outcome.conflicted).toBe(false);
    expect(outcome.document?.revision).toBe(1);
    expect(outcome.document?.reviewStatus).toBe('draft');
    expect(outcome.document?.supersededAt).toBeNull();
    expect(await countTree(handle, report.id)).toEqual({ documents: 1, claims: 3, citations: 3 });

    // Every citation row has EXACTLY ONE non-null source FK, and its source_kind
    // matches which FK is set.
    const rows = await handle.pool.query<{
      source_kind: string;
      experience_bullet_id: string | null;
      mastery_evidence_id: string | null;
      project_id: string | null;
      summary_id: string | null;
    }>(
      `select rc.source_kind, rc.experience_bullet_id, rc.mastery_evidence_id, rc.project_id, rc.summary_id
       from resume_claim_citations rc
       join resume_claims c on c.id = rc.resume_claim_id
       join resume_documents d on d.id = c.resume_document_id
       where d.fit_report_id = $1`,
      [report.id],
    );
    for (const row of rows.rows) {
      const set = [
        row.experience_bullet_id,
        row.mastery_evidence_id,
        row.project_id,
        row.summary_id,
      ].filter((v) => v !== null);
      expect(set).toHaveLength(1);
      const kindByColumn =
        row.experience_bullet_id !== null
          ? 'experience_bullet'
          : row.mastery_evidence_id !== null
            ? 'mastery_evidence'
            : row.project_id !== null
              ? 'project'
              : 'summary';
      expect(row.source_kind).toBe(kindByColumn);
    }

    // Positions assigned by array order.
    const found = await docsRepo.findCurrentDocument(user.id, report.id);
    expect(found?.claims.map((c) => c.claim.position)).toEqual([0, 1, 2]);
    expect(found?.claims[1]?.citations[0]?.sourceText).toContain('billing service');
  });
});

describe('the partial-unique-current invariant (at most one current per report)', () => {
  it('rejects a second non-superseded document for the report, and a duplicate revision', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    const first = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert()],
      documentInsert(inputs),
    );
    const runId = first.runs[0]?.id;
    const canonical = JSON.stringify(documentInsert(inputs).canonicalDoc);

    // A second CURRENT (superseded_at null) document, even at a different
    // revision, violates resume_documents_current_unique.
    let currentErr: unknown;
    try {
      await handle.pool.query(
        `insert into resume_documents (user_id, fit_report_id, compose_run_id, revision, canonical_doc)
         values ($1,$2,$3,$4,$5::jsonb)`,
        [user.id, report.id, runId, 2, canonical],
      );
    } catch (err) {
      currentErr = err;
    }
    expect(pgErrorCode(currentErr)).toBe('23505');

    // A duplicate (fit_report_id, revision) violates the revision-unique.
    let revErr: unknown;
    try {
      await handle.pool.query(
        `insert into resume_documents (user_id, fit_report_id, compose_run_id, revision, canonical_doc, superseded_at)
         values ($1,$2,$3,$4,$5::jsonb, now())`,
        [user.id, report.id, runId, 1, canonical],
      );
    } catch (err) {
      revErr = err;
    }
    expect(pgErrorCode(revErr)).toBe('23505');
  });
});

describe('profile-row deletion (REQUIRED-1 SET-NULL durability)', () => {
  it('deleting a cited bullet and a claim entity leaves rows + canonical_doc intact', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    const doc = documentInsert(inputs);
    const persisted = await docsRepo.persistComposeOutcome(user.id, report.id, [runInsert()], doc);
    const before = await countTree(handle, report.id);
    const canonicalBefore = JSON.stringify(persisted.document?.canonicalDoc);

    const bulletId = inputs.experiences[0]?.bullets[0]?.bulletId;
    const experienceId = inputs.experiences[0]?.experienceId;

    // Deleting a cited bullet SET-NULLs the citation FK (no CHECK violation).
    await handle.pool.query('delete from profile_experience_bullets where id = $1', [bulletId]);
    // Deleting the experience SET-NULLs the experience claim's entity FK.
    await handle.pool.query('delete from profile_experiences where id = $1', [experienceId]);

    // Row counts preserved (SET NULL nulls the pointer, never drops the row).
    expect(await countTree(handle, report.id)).toEqual(before);

    const bulletCite = await handle.pool.query<{ experience_bullet_id: string | null }>(
      "select experience_bullet_id from resume_claim_citations where source_kind = 'experience_bullet'",
    );
    expect(bulletCite.rows[0]?.experience_bullet_id).toBeNull();

    const expClaim = await handle.pool.query<{ experience_id: string | null }>(
      "select experience_id from resume_claims where section = 'experience'",
    );
    expect(expClaim.rows[0]?.experience_id).toBeNull();

    // canonical_doc snapshot is byte-unchanged.
    const doc2 = await docsRepo.findCurrentDocument(user.id, report.id);
    expect(JSON.stringify(doc2?.document.canonicalDoc)).toBe(canonicalBefore);
  });
});

describe('supersedeDocument (redraft CAS)', () => {
  it('supersedes the current, refuses a superseded/unknown id, and allows revision 2 as new current', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    const first = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert()],
      documentInsert(inputs),
    );
    const docId = first.document?.id;
    if (!docId) throw new Error('no document');

    const superseded = await docsRepo.supersedeDocument(user.id, docId);
    expect(superseded.kind).toBe('superseded');
    if (superseded.kind === 'superseded') expect(superseded.document.supersededAt).not.toBeNull();

    expect((await docsRepo.supersedeDocument(user.id, docId)).kind).toBe('not_current');
    expect(
      (await docsRepo.supersedeDocument(user.id, '00000000-0000-4000-8000-000000000000')).kind,
    ).toBe('not_found');

    // With rev 1 superseded, a fresh compose creates rev 2 as the current.
    const second = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert()],
      documentInsert(inputs),
    );
    expect(second.conflicted).toBe(false);
    expect(second.document?.revision).toBe(2);
    const current = await docsRepo.findCurrentDocument(user.id, report.id);
    expect(current?.document.revision).toBe(2);
  });
});

describe('markDocumentReviewed (one-shot CAS with superseded guard)', () => {
  it('draft->reviewed once; already_reviewed; superseded; not_found', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    const first = await docsRepo.persistComposeOutcome(
      user.id,
      report.id,
      [runInsert()],
      documentInsert(inputs),
    );
    const docId = first.document?.id;
    if (!docId) throw new Error('no document');

    expect((await docsRepo.markDocumentReviewed(user.id, docId, 'looks good')).kind).toBe(
      'reviewed',
    );
    expect((await docsRepo.markDocumentReviewed(user.id, docId, null)).kind).toBe(
      'already_reviewed',
    );
    expect(
      (await docsRepo.markDocumentReviewed(user.id, '00000000-0000-4000-8000-000000000000', null))
        .kind,
    ).toBe('not_found');

    // A superseded DRAFT document cannot be reviewed (a separate report).
    const fresh = await seedReportWithFullProfile();
    const freshDoc = await docsRepo.persistComposeOutcome(
      fresh.user.id,
      fresh.report.id,
      [runInsert()],
      documentInsert(fresh.inputs),
    );
    const freshId = freshDoc.document?.id;
    if (!freshId) throw new Error('no fresh document');
    await docsRepo.supersedeDocument(fresh.user.id, freshId);
    expect((await docsRepo.markDocumentReviewed(fresh.user.id, freshId, null)).kind).toBe(
      'superseded',
    );
  });
});

describe('findCurrentDocument derived stale flag (REQUIRED-3 completeness)', () => {
  it('is false right after compose and flips true when education OR a gap postdates the document', async () => {
    const { user, report, inputs } = await seedReportWithFullProfile();
    await docsRepo.persistComposeOutcome(user.id, report.id, [runInsert()], documentInsert(inputs));

    const fresh = await docsRepo.findCurrentDocument(user.id, report.id);
    expect(fresh?.stale).toBe(false);

    // Bump profile_education updated_at to the future -> stale.
    await handle.pool.query(
      "update profile_education set updated_at = now() + interval '1 hour' where user_id = $1",
      [user.id],
    );
    expect((await docsRepo.findCurrentDocument(user.id, report.id))?.stale).toBe(true);

    // A fresh report/document, then bump a GAP -> stale (guidance changed).
    const other = await seedReportWithFullProfile();
    await docsRepo.persistComposeOutcome(
      other.user.id,
      other.report.id,
      [runInsert()],
      documentInsert(other.inputs),
    );
    expect((await docsRepo.findCurrentDocument(other.user.id, other.report.id))?.stale).toBe(false);
    await handle.pool.query(
      "update gaps set updated_at = now() + interval '1 hour' where fit_report_id = $1",
      [other.report.id],
    );
    expect((await docsRepo.findCurrentDocument(other.user.id, other.report.id))?.stale).toBe(true);
  });
});

describe('findRequirementsForDocumentReport (M6-06 ats-coverage read)', () => {
  async function seedReportWithMixedRequirements() {
    const { user, posting } = await seedUserAndPosting();
    const outcome = await extractions.persistExtraction(
      user.id,
      posting.id,
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
      [
        {
          kind: 'must_have',
          category: 'language',
          text: 'TypeScript',
          sourceQuote: 'q1',
          confidence: 0.9,
          quoteVerified: true,
        },
        {
          kind: 'nice_to_have',
          category: 'framework',
          text: 'Kubernetes',
          sourceQuote: 'q2',
          confidence: 0.8,
          quoteVerified: false,
        },
        {
          kind: 'must_have',
          category: 'domain',
          text: 'Distributed systems',
          sourceQuote: 'q3',
          confidence: 0.7,
          quoteVerified: true,
        },
      ],
    );
    const run = outcome.runs[0];
    if (!run) throw new Error('seed produced no run');
    // quote_verified null (unverified) is a real stored state that arrives AFTER
    // insert (the M1-06 verify flow / column default) - persistExtraction takes a
    // boolean, so we null one out directly to exercise the tri-state passthrough.
    await handle.pool.query('update requirements set quote_verified = null where text = $1', [
      'Distributed systems',
    ]);
    const report = await fitRepo.persistFitReport(
      user.id,
      posting.id,
      run.id,
      reportData(),
      CRITERIA,
      assignmentsFor(outcome.requirements),
    );
    return { user, report: report.report };
  }

  it('returns the report requirements in (position, id) order with tri-state carried', async () => {
    const { user, report } = await seedReportWithMixedRequirements();
    const rows = await docsRepo.findRequirementsForDocumentReport(user.id, report.id);
    expect(rows.map((r) => r.text)).toEqual(['TypeScript', 'Kubernetes', 'Distributed systems']);
    expect(rows.map((r) => r.quoteVerified)).toEqual([true, false, null]);
    expect(rows.map((r) => r.kind)).toEqual(['must_have', 'nice_to_have', 'must_have']);
    expect(rows.map((r) => r.category)).toEqual(['language', 'framework', 'domain']);
    expect(
      rows.every((r) => typeof r.requirementId === 'string' && r.requirementId.length > 0),
    ).toBe(true);
  });

  it('is user-scoped: a stranger sees an empty list for the same report id', async () => {
    const { report } = await seedReportWithMixedRequirements();
    const { user: stranger } = await seedUserAndPosting();
    expect(await docsRepo.findRequirementsForDocumentReport(stranger.id, report.id)).toEqual([]);
  });
});

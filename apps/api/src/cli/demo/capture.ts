// The `demo:capture` pipeline body, extracted from the CLI shell so a keyless,
// mocked-provider test can drive it (the CLI itself hard-requires a live key).
// This module owns NO env reads, NO file IO, and NO scratch-DB lifecycle: the
// caller injects a migrated `db` and an `LlmProvider`, and receives the fixture
// set + usage back. All inputs are fictional (the example profile + the
// DEMO_POSTINGS); returned/logged values are counts/ids/statuses only - never
// posting or artifact text (RISKS P-01).
import { createHash } from 'node:crypto';

import {
  createExercisesRepository,
  createExtractionsRepository,
  createFitReportsRepository,
  createGapsRepository,
  createImprovementPlansRepository,
  createInterviewPrepsRepository,
  createApplicationGameplansRepository,
  createLearningPlansRepository,
  createMasteryEvidenceRepository,
  createPostingsRepository,
  createProfileFactsRepository,
  createProfileRepository,
  createResumeDocumentsRepository,
  createResumeVariantsRepository,
  createSearchCriteriaRepository,
  createUsersRepository,
  type Db,
} from '@careerforge/db';
import { type LlmProvider } from '@careerforge/llm';

import { createProfileImportService } from '../../modules/profile/profile.service.ts';
import { createExtractionService } from '../../modules/extraction/extraction.service.ts';
import { createFitService } from '../../modules/fit/fit.service.ts';
import { createPlansService } from '../../modules/plans/plans.service.ts';
import { createLearningService } from '../../modules/learning/learning.service.ts';
import { createInterviewPrepService } from '../../modules/interview-prep/interview-prep.service.ts';
import { createGameplanService } from '../../modules/gameplan/gameplan.service.ts';
import { createResumeComposeService } from '../../modules/resume-compose/resume-compose.service.ts';
import { createResumeService } from '../../modules/resume/resume.service.ts';
import { DEMO_POSTINGS } from './postings.ts';

export const FIXTURE_SET_VERSION = 'm10-03-v1';
export const CAPTURE_USER_EMAIL = 'demo.capture.scratch.fictional@example.com';

export interface CaptureUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
}

/** The tripwire counts for the interview-prep draft (value-free - counts only,
 *  no artifact text). null when the draft was never reached. Recorded so the
 *  BUILD RECORD can state WHICH disclosure count tripped when interview-prep
 *  flags (the M3-04 bidirectional-disclosure gate - an expected quality gate,
 *  not a defect). */
export type InterviewPrepTelemetry = Awaited<
  ReturnType<ReturnType<typeof createInterviewPrepService>['draft']>
>['telemetry'];

export interface DemoCaptureResult {
  fixtureSet: { version: string; postings: unknown[]; artifacts: Record<string, unknown> };
  strongestSlug: string;
  usage: CaptureUsage;
  interviewPrepTelemetry: InterviewPrepTelemetry | null;
}

/** Wrap a provider so every generate() call is tallied (calls + token usage).
 *  The demo:capture live run reports spend from this; the test asserts the
 *  mock was actually exercised. */
function countingProvider(inner: LlmProvider, usage: CaptureUsage): LlmProvider {
  return {
    name: inner.name,
    async generate(request) {
      const result = await inner.generate(request);
      usage.calls += 1;
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.cacheReadInputTokens += result.usage.cacheReadInputTokens;
      return result;
    },
  };
}

/**
 * Drive the real pipeline once over the fictional inputs and return the
 * exportable fixture set. Ingest + extract + deterministically score every
 * posting, pick the strongest fit (fewest gaps - there is no merged overall
 * score by design, M1-10), then draft the six LLM artifacts on it with a
 * retry-until-persisted loop (a flagged draft writes no row, so re-drafting is
 * safe). The caller serializes + hashes + writes the result.
 */
export async function runDemoCapture(deps: {
  db: Db;
  provider: LlmProvider;
  profileDir: string;
  log?: (line: string) => void;
}): Promise<DemoCaptureResult> {
  const { db, profileDir } = deps;
  const log = deps.log ?? (() => {});
  const usage: CaptureUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const provider = countingProvider(deps.provider, usage);

  // Scratch user + example profile (+ criteria the fit engine needs).
  const user = await createUsersRepository(db).create({
    email: CAPTURE_USER_EMAIL,
    passwordHash: 'fake-hash-not-a-real-credential',
  });
  await createProfileImportService({
    profileDir,
    profile: createProfileRepository(db),
    facts: createProfileFactsRepository(db),
    criteria: createSearchCriteriaRepository(db),
  }).importProfile(user.id, { forceCriteria: true });
  log(`example profile imported for scratch user`);

  // Repositories + services (drive the pipeline directly, no HTTP).
  const postingsRepo = createPostingsRepository(db);
  const extractionsRepo = createExtractionsRepository(db);
  const fitReportsRepo = createFitReportsRepository(db);
  const gapsRepo = createGapsRepository(db);
  const profileRepo = createProfileRepository(db);

  const extraction = createExtractionService({
    postings: postingsRepo,
    extractions: extractionsRepo,
    provider,
  });
  const fit = createFitService({
    postings: postingsRepo,
    extractions: extractionsRepo,
    criteria: createSearchCriteriaRepository(db),
    profile: profileRepo,
    facts: createProfileFactsRepository(db),
    fitReports: fitReportsRepo,
    gaps: gapsRepo,
  });

  const postingRecords: { slug: string; postingId: string; gapCount: number }[] = [];
  const fixtureSet: DemoCaptureResult['fixtureSet'] = {
    version: FIXTURE_SET_VERSION,
    postings: [],
    artifacts: {},
  };
  const postingsOut: unknown[] = [];

  for (const input of DEMO_POSTINGS) {
    const { posting } = await postingsRepo.ingest(user.id, {
      rawText: input.rawText,
      contentHash: createHash('sha256').update(input.rawText).digest('hex'),
      company: input.company,
      title: input.title,
      sourceNote: null,
    });
    await extraction.extract(user.id, posting.id, false);
    const extractionRun = await extractionsRepo.findLatestRequirementBearingRun(
      user.id,
      posting.id,
    );
    await fit.score(user.id, posting.id);
    const scored = await fitReportsRepo.findLatestReport(user.id, posting.id);
    if (!scored) throw new Error(`no fit report for ${input.slug}`);
    const gapsResponse = await fit.getGaps(user.id, scored.report.id);
    postingRecords.push({
      slug: input.slug,
      postingId: posting.id,
      gapCount: gapsResponse.gaps.length,
    });
    postingsOut.push({
      slug: input.slug,
      input: { company: input.company, title: input.title, rawText: input.rawText },
      extraction: extractionRun,
      gapCount: gapsResponse.gaps.length,
    });
    log(`  ${input.slug}: extracted + scored (${String(gapsResponse.gaps.length)} gaps)`);
  }
  fixtureSet.postings = postingsOut;

  // "Strongest fit" proxy: fewest gaps (there is no merged overall score by
  // design - M1-10). Ties break on posting order (stable).
  const strongest = [...postingRecords].sort((a, b) => a.gapCount - b.gapCount)[0];
  if (!strongest) throw new Error('no postings captured');
  log(`strongest fit (fewest gaps): ${strongest.slug} (${String(strongest.gapCount)} gaps)`);
  const strongestReport = await fitReportsRepo.findLatestReport(user.id, strongest.postingId);
  if (!strongestReport) throw new Error('strongest posting has no fit report');
  const reportId = strongestReport.report.id;
  const gapsForStrongest = await fit.getGaps(user.id, reportId);
  // Drafting the artifacts requires a reviewed source report (the normal flow:
  // a human reviews the fit before drafting). This is the report review, NOT
  // the artifact review - the artifacts' reviewed state is decided separately.
  await fit.review(user.id, reportId, null);
  log(`fit report reviewed (prerequisite for drafting)`);

  // The six LLM-draft artifacts, on the strongest fit. Each carries a
  // citation / quote tripwire that can flag a draft (persisting no row)
  // non-deterministically, and a different subset flags each capture, so every
  // artifact is drafted with a retry-until-persisted loop. A flagged attempt
  // writes no row (free-create / no-cache), so re-drafting is safe.
  const improvementPlansRepo = createImprovementPlansRepository(db);
  const learningPlansRepo = createLearningPlansRepository(db);
  const interviewPrepsRepo = createInterviewPrepsRepository(db);
  const gameplansRepo = createApplicationGameplansRepository(db);
  const resumeDocumentsRepo = createResumeDocumentsRepository(db);
  const resumeVariantsRepo = createResumeVariantsRepository(db);

  const plans = createPlansService({
    plans: improvementPlansRepo,
    gaps: gapsRepo,
    profile: profileRepo,
    provider,
  });
  const learning = createLearningService({
    learning: learningPlansRepo,
    gaps: gapsRepo,
    profile: profileRepo,
    exercises: createExercisesRepository(db),
    masteryEvidence: createMasteryEvidenceRepository(db),
    provider,
  });
  const interviewPrep = createInterviewPrepService({
    interviews: interviewPrepsRepo,
    learningPlanPointers: learningPlansRepo,
    profile: profileRepo,
    provider,
  });
  const gameplan = createGameplanService({
    gameplans: gameplansRepo,
    profile: profileRepo,
    provider,
  });
  const resumeCompose = createResumeComposeService({ documents: resumeDocumentsRepo, provider });
  const resume = createResumeService({
    variants: resumeVariantsRepo,
    gaps: gapsRepo,
    profile: profileRepo,
    provider,
  });

  async function captureArtifact<T>(
    name: string,
    draft: () => Promise<unknown>,
    read: () => Promise<T | undefined | null>,
    maxAttempts = 5,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await draft();
      const row = await read();
      if (row !== undefined && row !== null) {
        log(`  ${name}: persisted (attempt ${String(attempt)})`);
        return row;
      }
      log(
        `  ${name}: flagged (attempt ${String(attempt)})${attempt < maxAttempts ? ', retrying' : ''}`,
      );
    }
    return null;
  }

  // interview-prep is the one draft that legitimately flags even on a live
  // model (the M3-04 bidirectional-disclosure gate) - capture its tripwire
  // counts (value-free) so the BUILD RECORD can state which count tripped.
  let interviewPrepTelemetry: InterviewPrepTelemetry | null = null;

  const learningGapIds = gapsForStrongest.gaps.slice(0, 3).map((g) => g.id);
  const artifacts = {
    strongestSlug: strongest.slug,
    improvementPlan: await captureArtifact(
      'improvement-plan',
      () => plans.draft(user.id, reportId),
      () => improvementPlansRepo.findPlanForReport(user.id, reportId),
    ),
    learningPlan: await captureArtifact(
      'learning-plan',
      () => learning.draft(user.id, { gapIds: learningGapIds }),
      async () => {
        const list = await learningPlansRepo.listLearningPlans(user.id);
        const id = list[0]?.id;
        return id ? await learningPlansRepo.findLearningPlan(user.id, id) : undefined;
      },
    ),
    interviewPrep: await captureArtifact(
      'interview-prep',
      async () => {
        const result = await interviewPrep.draft(user.id, strongest.postingId);
        interviewPrepTelemetry = result.telemetry;
        return result;
      },
      () => interviewPrepsRepo.findPrepForReport(user.id, reportId),
    ),
    gameplan: await captureArtifact(
      'gameplan',
      () => gameplan.draft(user.id, strongest.postingId),
      () => gameplansRepo.findGameplanForReport(user.id, reportId),
    ),
    resumeDocument: await captureArtifact(
      'resume-document',
      () => resumeCompose.compose(user.id, reportId),
      () => resumeDocumentsRepo.findCurrentDocument(user.id, reportId),
    ),
    resumeVariant: await captureArtifact(
      'resume-variant',
      () => resume.draft(user.id, reportId),
      () => resumeVariantsRepo.findVariantForReport(user.id, reportId),
    ),
  };
  fixtureSet.artifacts = artifacts;
  const persistedCount = Object.entries(artifacts).filter(
    ([k, v]) => k !== 'strongestSlug' && v !== null,
  ).length;
  log(`  ${strongest.slug}: ${String(persistedCount)}/6 artifacts persisted`);
  if (interviewPrepTelemetry !== null) {
    const t: InterviewPrepTelemetry = interviewPrepTelemetry;
    log(
      `  interview-prep telemetry (value-free): fabricated=${String(t.fabricatedRefCount)} ` +
        `crossReq=${String(t.crossRequirementEvidenceCount)} ` +
        `missingDisclosure=${String(t.missingDisclosureCount)} ` +
        `spuriousDisclosure=${String(t.spuriousDisclosureCount)} ` +
        `excludedReqs=${String(t.excludedRequirementCount)}`,
    );
  }

  return { fixtureSet, strongestSlug: strongest.slug, usage, interviewPrepTelemetry };
}

// `pnpm demo:capture` (M10-03) — operator-attended, LOCAL, LIVE-key capture.
//
// Drives the REAL pipeline once, on a throwaway scratch database, over the
// fictional DEMO_POSTINGS against the fictional example profile, and exports the
// results as a committed fixture set + manifest. `demo:seed` (keyless) later
// replays those fixtures, so the public demo never calls the provider. Fixture
// content is derived ONLY from fictional inputs (RISKS P-01); stdout carries
// counts/ids/statuses only — never posting or artifact text.
//
// Preconditions: ANTHROPIC_API_KEY present, DEMO_MODE OFF (a keyed demo cannot
// boot — see env.ts), a reachable local Postgres. Never touches the dev DB: it
// creates, migrates, and drops its own `careerforge_demo_capture` scratch DB.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDb,
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
  runMigrations,
} from '@careerforge/db';
import { createAnthropicProvider, type LlmProvider } from '@careerforge/llm';

import { createProfileImportService } from '../modules/profile/profile.service.ts';
import { createExtractionService } from '../modules/extraction/extraction.service.ts';
import { createFitService } from '../modules/fit/fit.service.ts';
import { createPlansService } from '../modules/plans/plans.service.ts';
import { createLearningService } from '../modules/learning/learning.service.ts';
import { createInterviewPrepService } from '../modules/interview-prep/interview-prep.service.ts';
import { createGameplanService } from '../modules/gameplan/gameplan.service.ts';
import { createResumeComposeService } from '../modules/resume-compose/resume-compose.service.ts';
import { createResumeService } from '../modules/resume/resume.service.ts';
import { DEMO_POSTINGS } from './demo/postings.ts';

const FIXTURE_SET_VERSION = 'm10-03-v1';
const SCRATCH_DB = 'careerforge_demo_capture';
const CAPTURE_USER_EMAIL = 'demo.capture.scratch.fictional@example.com';
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const fixturesDir = path.join(repoRoot, 'apps/api/src/cli/demo/fixtures');
const profileDir = path.join(repoRoot, 'docs/profile.example');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
function fail(message: string): never {
  process.stderr.write(`demo:capture: ${message}\n`);
  process.exit(1);
}

// --- preconditions ----------------------------------------------------------
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) fail('ANTHROPIC_API_KEY is required for a live capture (it is a paid run).');
if (process.env.DEMO_MODE === '1')
  fail('DEMO_MODE must be OFF for capture (a keyed demo cannot boot).');
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) fail('DATABASE_URL is not set — .env.example documents it.');
const model = process.env.LLM_MODEL ?? 'claude-sonnet-5';

const scratchUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${SCRATCH_DB}`;
  return u.toString();
})();
const adminUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = '/postgres';
  return u.toString();
})();

// --- usage-tallying live provider -------------------------------------------
const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
function countingProvider(inner: LlmProvider): LlmProvider {
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

// Maintenance connection to the `postgres` DB (via packages/db's pool, so
// apps/api needs no direct pg dependency) — for CREATE/DROP of the scratch DB.
async function withAdmin(
  fn: (query: (sql: string) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const admin = createDb(adminUrl);
  try {
    await fn((sql) => admin.pool.query(sql));
  } finally {
    await admin.pool.end();
  }
}

async function main(): Promise<void> {
  // Fresh scratch DB.
  await withAdmin(async (query) => {
    await query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await query(`CREATE DATABASE ${SCRATCH_DB}`);
  });
  await runMigrations(scratchUrl);
  out(`scratch DB ${SCRATCH_DB} created + migrated`);

  const { db, pool } = createDb(scratchUrl);
  try {
    const provider = countingProvider(createAnthropicProvider({ apiKey: apiKey as string, model }));

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
    out(`example profile imported for scratch user`);

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
    const fixtureSet: Record<string, unknown> = { version: FIXTURE_SET_VERSION, postings: [] };
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
      if (!scored) fail(`no fit report for ${input.slug}`);
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
      out(`  ${input.slug}: extracted + scored (${gapsResponse.gaps.length} gaps)`);
    }
    fixtureSet.postings = postingsOut;

    // "Strongest fit" proxy: fewest gaps (there is no merged overall score by
    // design — M1-10). Ties break on posting order (stable).
    const strongest = [...postingRecords].sort((a, b) => a.gapCount - b.gapCount)[0];
    if (!strongest) fail('no postings captured');
    out(`strongest fit (fewest gaps): ${strongest.slug} (${strongest.gapCount} gaps)`);
    const strongestReport = await fitReportsRepo.findLatestReport(user.id, strongest.postingId);
    if (!strongestReport) fail('strongest posting has no fit report');
    const reportId = strongestReport.report.id;
    const gapsForStrongest = await fit.getGaps(user.id, reportId);
    // Drafting the artifacts requires a reviewed source report (the normal flow:
    // a human reviews the fit before drafting). This is the report review, NOT
    // the artifact review — the artifacts' reviewed state is decided separately.
    await fit.review(user.id, reportId, null);
    out(`fit report reviewed (prerequisite for drafting)`);

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
          out(`  ${name}: persisted (attempt ${String(attempt)})`);
          return row;
        }
        out(
          `  ${name}: flagged (attempt ${String(attempt)})${attempt < maxAttempts ? ', retrying' : ''}`,
        );
      }
      return null;
    }

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
        () => interviewPrep.draft(user.id, strongest.postingId),
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
    out(`  ${strongest.slug}: ${String(persistedCount)}/6 artifacts persisted`);

    // Write the fixture set + manifest.
    mkdirSync(fixturesDir, { recursive: true });
    const setJson = `${JSON.stringify(fixtureSet, null, 2)}\n`;
    const setPath = path.join(fixturesDir, 'demo-fixture-set.json');
    writeFileSync(setPath, setJson);
    const manifest = {
      fixtureSetVersion: FIXTURE_SET_VERSION,
      capturedAt: new Date().toISOString(),
      strongestSlug: strongest.slug,
      fixtureManifestSha256: createHash('sha256').update(setJson).digest('hex'),
      usage,
    };
    writeFileSync(
      path.join(fixturesDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    out('');
    out(`fixture set written: ${path.relative(repoRoot, setPath)}`);
    out(`manifest sha256: ${manifest.fixtureManifestSha256}`);
    out(
      `LLM usage: ${usage.calls} calls, ${usage.inputTokens} in / ${usage.outputTokens} out / ${usage.cacheReadInputTokens} cache-read tokens`,
    );
  } finally {
    await pool.end();
    await withAdmin(async (query) => {
      await query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    });
    out(`scratch DB ${SCRATCH_DB} dropped`);
  }
}

await main();

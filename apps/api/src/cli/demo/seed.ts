// The `demo:seed` pipeline body (M10-03), extracted like runDemoCapture so it is
// testable against a docker Postgres. KEYLESS: it never calls the provider — it
// replays the committed fixture set (demo:capture's honest snapshot) into the
// bootstrap user, RECOMPUTING fit with the live deterministic engine at seed
// time (so seeded fit reports are genuinely computed, not copied), and inserting
// the captured artifacts re-linked to the recomputed reports/gaps/entities by
// IDENTITY (the captured UUIDs are dead — fit recompute mints fresh ids).
// Idempotent: deletes the bootstrap user's posting-derived graph + learning
// plans first, so a re-seed rebuilds identically. All inputs are fictional
// (the example profile + DEMO_POSTINGS); returned/logged values are
// counts/ids/statuses only, never posting or artifact text (RISKS P-01).
import { createHash } from 'node:crypto';

import {
  createApplicationGameplansRepository,
  createDemoSeedStateRepository,
  createExtractionsRepository,
  createFitReportsRepository,
  createGapsRepository,
  createImprovementPlansRepository,
  createLearningPlansRepository,
  createPostingsRepository,
  createProfileFactsRepository,
  createProfileRepository,
  createResumeDocumentsRepository,
  createResumeVariantsRepository,
  createSearchCriteriaRepository,
  type ComposeCitationInsert,
  type Db,
  type DemoSeedMarker,
  type ExtractionRunInsert,
  type RequirementInsert,
} from '@careerforge/db';

import { createProfileImportService } from '../../modules/profile/profile.service.ts';
import { createFitService } from '../../modules/fit/fit.service.ts';
import { DEMO_POSTINGS } from './postings.ts';

// The artifacts that ship marked `reviewed` (operator-approved 2026-08-02); the
// rest stay `draft`, so the demo shows both states. interview-prep is not seeded
// at all (it flagged at capture — the disclosure gate withheld it, seeded as-is).
export const REVIEWED_FAMILIES: ReadonlySet<string> = new Set([
  'improvementPlan',
  'gameplan',
  'resumeDocument',
]);

/**
 * Amendment-3 DATA-level refusal: never clobber a real instance. If the target
 * user already has demo-owned domain rows (postings or an imported profile) but
 * NO demo_seed_state marker, the rows were not written by a prior demo:seed —
 * they are (or could be) a real user's data — so refuse. A marker present means
 * a prior demo:seed owns the data and re-seeding is safe (idempotent rebuild).
 */
export class DemoSeedRefusedError extends Error {
  constructor() {
    super(
      'refusing to seed: the target user has data but no demo_seed_state marker (not a demo-owned instance)',
    );
  }
}

// ---- fixture read shapes (JSON: dates are strings) --------------------------
interface FxRun {
  promptId: string;
  provider: string;
  model: string;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  attempt: number;
  status: string;
  createdAt: string;
}
interface FxRequirementIdentity {
  requirementText: string;
  requirementKind: string;
  requirementCategory: string;
}
interface FxExtractionReq {
  kind: RequirementInsert['kind'];
  category: RequirementInsert['category'];
  text: string;
  sourceQuote: string;
  quoteVerified: boolean;
  confidence: number;
}
interface FxPosting {
  slug: string;
  input: { company: string; title: string; rawText: string };
  extraction: { run: FxRun; requirements: FxExtractionReq[] } | null;
  gapCount: number;
}
interface FxPlanItem extends FxRequirementIdentity {
  item: { action: string; priority: 'high' | 'medium' | 'low' };
}
interface FxLearningGap extends FxRequirementIdentity {
  row: { focus: string; priority: 'high' | 'medium' | 'low' };
}
interface FxStory {
  story: { situation: string; task: string; action: string; result: string };
  citations: (FxRequirementIdentity & { postingQuote: string; profileQuote: string })[];
}
interface FxCanonicalClaim {
  text: string;
  section: 'summary' | 'experience' | 'project';
  entityRef: string | null;
  entityLabel: string | null;
}
interface FxDocClaim {
  claim: { section: 'summary' | 'experience' | 'project'; text: string };
  citations: {
    sourceKind: ComposeCitationInsert['sourceKind'];
    sourceText: string;
    experienceBulletId: string | null;
    projectId: string | null;
    summaryId: string | null;
    masteryEvidenceId: string | null;
  }[];
}
interface FxVariantEntry {
  entry: {
    section: 'skill' | 'experience' | 'project';
    position: number;
    label: string;
    detail: string | null;
    emphasis: 'lead' | 'highlight' | null;
    reason: string | null;
  };
  citations: FxRequirementIdentity[];
}
interface FxFixtureSet {
  version: string;
  postings: FxPosting[];
  artifacts: {
    strongestSlug: string;
    improvementPlan: { plan: { reviewStatus: string }; run: FxRun; items: FxPlanItem[] } | null;
    learningPlan: {
      plan: { title: string; reviewStatus: string };
      run: FxRun;
      gaps: FxLearningGap[];
    } | null;
    interviewPrep: unknown;
    gameplan: {
      gameplan: { strategySummary: string; reviewStatus: string };
      run: FxRun;
      phaseStrategies: { phase: 'apply' | 'screen' | 'interview' | 'offer'; strategy: string }[];
      stories: FxStory[];
    } | null;
    resumeDocument: {
      document: { canonicalDoc: { claims: FxCanonicalClaim[] }; reviewStatus: string };
      claims: FxDocClaim[];
    } | null;
    resumeVariant: {
      variant: { renderedMarkdown: string; reviewStatus: string };
      run: FxRun;
      entries: FxVariantEntry[];
    } | null;
  };
}

// ---- helpers ----------------------------------------------------------------
const idKey = (r: FxRequirementIdentity): string =>
  `${r.requirementText.trim()}|${r.requirementKind}|${r.requirementCategory}`;

/** Map a captured audit run to a fresh insert. Status is cast: the captured runs
 *  are terminal-success ('ok'/'completed'), and each family's insert excludes
 *  'flagged' — the demo just needs an honest audit row. */
function toRunInsert<S>(run: FxRun): Omit<ExtractionRunInsert, 'status'> & { status: S } {
  return {
    promptId: run.promptId,
    provider: run.provider,
    model: run.model,
    rawResponse: run.rawResponse,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheReadInputTokens: run.cacheReadInputTokens,
    cacheCreationInputTokens: run.cacheCreationInputTokens,
    latencyMs: run.latencyMs,
    attempt: run.attempt,
    status: run.status as S,
    createdAt: new Date(run.createdAt),
  };
}

export interface DemoSeedSummary {
  postings: number;
  requirements: number;
  fitReports: number;
  gaps: number;
  /** The recomputed strongest-fit report id (drafting anchor) — lets callers
   *  read back the seeded artifacts to verify the reviewed/draft split. */
  strongestReportId: string;
  artifacts: { family: string; reviewStatus: 'reviewed' | 'draft' }[];
}

export async function runDemoSeed(deps: {
  db: Db;
  userId: string;
  fixtureSet: unknown;
  manifest: DemoSeedMarker;
  profileDir: string;
  log?: (line: string) => void;
}): Promise<DemoSeedSummary> {
  const { db, userId, profileDir, manifest } = deps;
  const log = deps.log ?? (() => {});
  const fixture = deps.fixtureSet as FxFixtureSet;

  const postingsRepo = createPostingsRepository(db);
  const extractionsRepo = createExtractionsRepository(db);
  const fitReportsRepo = createFitReportsRepository(db);
  const gapsRepo = createGapsRepository(db);
  const profileRepo = createProfileRepository(db);
  const learningPlansRepo = createLearningPlansRepository(db);
  const seedStateRepo = createDemoSeedStateRepository(db);

  // 0. AMENDMENT-3 REFUSAL: if the user has data but no demo marker, it is not a
  //    demo-owned instance — refuse rather than delete a real user's rows.
  const marker = await seedStateRepo.read();
  if (marker === undefined) {
    const hasPostings = (await postingsRepo.listForUser(userId)).length > 0;
    const hasProfile = (await profileRepo.getProfile(userId)).skills.length > 0;
    if (hasPostings || hasProfile) throw new DemoSeedRefusedError();
  }

  // 1. IDEMPOTENCY: clear the bootstrap user's posting-derived graph (cascades
  //    to extractions/fit/gaps/artifacts) + free-create learning plans. The
  //    profile importer (below) delete-reinserts profile rows itself.
  const deletedPostings = await postingsRepo.deleteAllForUser(userId);
  const deletedLearning = await learningPlansRepo.deleteAllForUser(userId);
  log(
    `cleared prior demo data (${String(deletedPostings)} postings, ${String(deletedLearning)} learning plans)`,
  );

  // 2. Import the example profile into the bootstrap user.
  await createProfileImportService({
    profileDir,
    profile: profileRepo,
    facts: createProfileFactsRepository(db),
    criteria: createSearchCriteriaRepository(db),
  }).importProfile(userId, { forceCriteria: true });
  log('example profile imported into the bootstrap user');

  const fit = createFitService({
    postings: postingsRepo,
    extractions: extractionsRepo,
    criteria: createSearchCriteriaRepository(db),
    profile: profileRepo,
    facts: createProfileFactsRepository(db),
    fitReports: fitReportsRepo,
    gaps: gapsRepo,
  });

  // 3. Replay extractions + recompute fit per posting; collect the recomputed
  //    gap-id map (requirement identity -> fresh gap id) for the strongest.
  const bySlug = new Map<string, { postingId: string; reportId: string }>();
  let requirementCount = 0;
  let gapCount = 0;
  for (const input of DEMO_POSTINGS) {
    const fx = fixture.postings.find((p) => p.slug === input.slug);
    if (!fx?.extraction) throw new Error(`fixture has no extraction for ${input.slug}`);
    const { posting } = await postingsRepo.ingest(userId, {
      rawText: input.rawText,
      contentHash: createHash('sha256').update(input.rawText).digest('hex'),
      company: input.company,
      title: input.title,
      sourceNote: null,
    });
    const requirements: RequirementInsert[] = fx.extraction.requirements.map((r) => ({
      kind: r.kind,
      category: r.category,
      text: r.text,
      sourceQuote: r.sourceQuote,
      confidence: r.confidence,
      quoteVerified: r.quoteVerified,
    }));
    await extractionsRepo.persistExtraction(
      userId,
      posting.id,
      [toRunInsert<Exclude<ExtractionRunInsert['status'], never>>(fx.extraction.run)],
      requirements,
    );
    requirementCount += requirements.length;
    await fit.score(userId, posting.id);
    const scored = await fitReportsRepo.findLatestReport(userId, posting.id);
    if (!scored) throw new Error(`no fit report after score for ${input.slug}`);
    bySlug.set(input.slug, { postingId: posting.id, reportId: scored.report.id });
    log(`  ${input.slug}: replayed + rescored`);
  }

  const strongest = bySlug.get(fixture.artifacts.strongestSlug);
  if (!strongest)
    throw new Error(`strongest posting ${fixture.artifacts.strongestSlug} not seeded`);
  const reportId = strongest.reportId;

  // The strongest report is reviewed (drafting's precondition + an honest demo
  // state: a human reviewed the fit before the artifacts were drafted).
  await fit.review(userId, reportId, null);

  const gapsResp = await fit.getGaps(userId, reportId);
  gapCount = (await fit.getGaps(userId, reportId)).gaps.length; // recorded for the summary
  const gapIdByReq = new Map<string, string>();
  for (const g of gapsResp.gaps) {
    gapIdByReq.set(
      idKey({
        requirementText: g.requirementText,
        requirementKind: g.requirementKind,
        requirementCategory: g.requirementCategory,
      }),
      g.id,
    );
  }
  const resolveGap = (r: FxRequirementIdentity): string => {
    const id = gapIdByReq.get(idKey(r));
    if (id === undefined)
      throw new Error(`no recomputed gap for requirement "${r.requirementText}"`);
    return id;
  };

  const artifacts: DemoSeedSummary['artifacts'] = [];
  const reviewed = (family: string): 'reviewed' | 'draft' =>
    REVIEWED_FAMILIES.has(family) ? 'reviewed' : 'draft';

  // 4. Insert the captured artifacts, remapped to the recomputed graph.
  await seedImprovementPlan(db, userId, reportId, fixture, resolveGap, reviewed, artifacts, log);
  await seedLearningPlan(db, userId, fixture, resolveGap, reviewed, artifacts, log);
  await seedGameplan(db, userId, reportId, fixture, reviewed, artifacts, log);
  await seedResumeDocument(db, userId, reportId, fixture, reviewed, artifacts, log);
  await seedResumeVariant(db, userId, reportId, fixture, resolveGap, reviewed, artifacts, log);

  // 5. Write the marker LAST — its presence is the boot check's "seeded" signal
  //    (D7b) and the amendment-3 "demo-owned" signal. Upsert = idempotent.
  await seedStateRepo.upsert(manifest);
  log('demo_seed_state marker written');

  return {
    postings: DEMO_POSTINGS.length,
    requirements: requirementCount,
    fitReports: bySlug.size,
    gaps: gapCount,
    strongestReportId: reportId,
    artifacts,
  };
}

type Reviewed = (family: string) => 'reviewed' | 'draft';
type Artifacts = DemoSeedSummary['artifacts'];
type Log = (line: string) => void;

async function seedImprovementPlan(
  db: Db,
  userId: string,
  reportId: string,
  fixture: FxFixtureSet,
  resolveGap: (r: FxRequirementIdentity) => string,
  reviewed: Reviewed,
  artifacts: Artifacts,
  log: Log,
): Promise<void> {
  const fx = fixture.artifacts.improvementPlan;
  if (!fx) return;
  const repo = createImprovementPlansRepository(db);
  await repo.persistDraftingOutcome(
    userId,
    reportId,
    [toRunInsert(fx.run)],
    false,
    fx.items.map((it) => ({
      gapId: resolveGap(it),
      action: it.item.action,
      priority: it.item.priority,
      // Recommendations are not carried in the read-back fixture shape (a known
      // capture-lossy residual); the demo shows plans without typed recs.
    })),
  );
  const plan = await repo.findPlanForReport(userId, reportId);
  if (!plan) throw new Error('improvement plan did not persist');
  const status = reviewed('improvementPlan');
  if (status === 'reviewed') await repo.markPlanReviewed(userId, plan.plan.id, null);
  artifacts.push({ family: 'improvementPlan', reviewStatus: status });
  log(`  improvement-plan seeded (${status})`);
}

async function seedLearningPlan(
  db: Db,
  userId: string,
  fixture: FxFixtureSet,
  resolveGap: (r: FxRequirementIdentity) => string,
  reviewed: Reviewed,
  artifacts: Artifacts,
  log: Log,
): Promise<void> {
  const fx = fixture.artifacts.learningPlan;
  if (!fx) return;
  const repo = createLearningPlansRepository(db);
  const outcome = await repo.persistDraftingOutcome(userId, [toRunInsert(fx.run)], false, {
    title: fx.plan.title,
    gaps: fx.gaps.map((g) => ({
      gapId: resolveGap(g),
      focus: g.row.focus,
      priority: g.row.priority,
    })),
  });
  if (!outcome.planId) throw new Error('learning plan did not persist');
  const status = reviewed('learningPlan');
  if (status === 'reviewed') await repo.markLearningPlanReviewed(userId, outcome.planId, null);
  artifacts.push({ family: 'learningPlan', reviewStatus: status });
  log(`  learning-plan seeded (${status})`);
}

async function seedGameplan(
  db: Db,
  userId: string,
  reportId: string,
  fixture: FxFixtureSet,
  reviewed: Reviewed,
  artifacts: Artifacts,
  log: Log,
): Promise<void> {
  const fx = fixture.artifacts.gameplan;
  if (!fx) return;
  const repo = createApplicationGameplansRepository(db);
  // Story citations reference evidence-link ids the fit engine re-created at
  // score time. Remap by (postingQuote, profileQuote) — the evidence link's
  // natural key on a report.
  const evidence = await repo.findEvidenceForReport(userId, reportId);
  const evByQuotes = new Map<string, string>();
  for (const e of evidence) evByQuotes.set(`${e.postingQuote}|${e.profileQuote}`, e.evidenceLinkId);
  const phaseStrategies = Object.fromEntries(
    fx.phaseStrategies.map((p) => [p.phase, p.strategy]),
  ) as Record<'apply' | 'screen' | 'interview' | 'offer', string>;
  await repo.persistDraftingOutcome(userId, reportId, [toRunInsert(fx.run)], false, {
    strategySummary: fx.gameplan.strategySummary,
    phaseStrategies,
    stories: fx.stories.map((s) => ({
      situation: s.story.situation,
      task: s.story.task,
      action: s.story.action,
      result: s.story.result,
      citations: s.citations.flatMap((c) => {
        const id = evByQuotes.get(`${c.postingQuote}|${c.profileQuote}`);
        return id === undefined ? [] : [{ evidenceLinkId: id }];
      }),
    })),
  });
  const gp = await repo.findGameplanForReport(userId, reportId);
  if (!gp) throw new Error('gameplan did not persist');
  const status = reviewed('gameplan');
  if (status === 'reviewed') await repo.markGameplanReviewed(userId, gp.gameplan.id, null);
  artifacts.push({ family: 'gameplan', reviewStatus: status });
  log(`  gameplan seeded (${status})`);
}

async function seedResumeDocument(
  db: Db,
  userId: string,
  reportId: string,
  fixture: FxFixtureSet,
  reviewed: Reviewed,
  artifacts: Artifacts,
  log: Log,
): Promise<void> {
  const fx = fixture.artifacts.resumeDocument;
  if (!fx) return;
  const repo = createResumeDocumentsRepository(db);
  const inputs = await repo.getComposeInputs(userId, reportId);
  const summaryByText = new Map(inputs.summaries.map((s) => [s.text, s.summaryId]));
  const bulletByText = new Map(
    inputs.experiences.flatMap((e) => e.bullets.map((b) => [b.text, b.bulletId] as const)),
  );
  const projectByName = new Map(inputs.projects.map((p) => [p.name, p.projectId]));
  const projectByDesc = new Map(inputs.projects.map((p) => [p.description, p.projectId]));
  const matchExperience = (label: string): string | null =>
    inputs.experiences.find((e) => label.includes(e.company) && label.includes(e.title))
      ?.experienceId ?? null;

  // canonicalDoc.claims carry the entity labels (position-aligned with claims[]).
  const canonical = fx.document.canonicalDoc.claims;
  const claims = fx.claims.map((c, i) => {
    const can = canonical[i];
    const experienceId =
      c.claim.section === 'experience' && can?.entityLabel
        ? matchExperience(can.entityLabel)
        : null;
    const projectId =
      c.claim.section === 'project' && can?.entityLabel
        ? (projectByName.get(can.entityLabel) ?? null)
        : null;
    return {
      section: c.claim.section,
      experienceId,
      projectId,
      text: c.claim.text,
      citations: c.citations.map((cit) => ({
        sourceKind: cit.sourceKind,
        sourceText: cit.sourceText,
        experienceBulletId: cit.experienceBulletId
          ? (bulletByText.get(cit.sourceText) ?? null)
          : null,
        projectId: cit.projectId ? (projectByDesc.get(cit.sourceText) ?? null) : null,
        summaryId: cit.summaryId ? (summaryByText.get(cit.sourceText) ?? null) : null,
        masteryEvidenceId: null,
      })),
    };
  });

  const outcome = await repo.persistComposeOutcome(
    userId,
    reportId,
    [
      {
        promptId: 'resume-compose@v1',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        rawResponse: {},
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        latencyMs: 0,
        attempt: 1,
        status: 'ok',
        createdAt: new Date(),
      },
    ],
    { canonicalDoc: fx.document.canonicalDoc as never, claims },
  );
  if (!outcome.document) throw new Error('resume document did not persist');
  const status = reviewed('resumeDocument');
  if (status === 'reviewed') await repo.markDocumentReviewed(userId, outcome.document.id, null);
  artifacts.push({ family: 'resumeDocument', reviewStatus: status });
  log(`  resume-document seeded (${status})`);
}

async function seedResumeVariant(
  db: Db,
  userId: string,
  reportId: string,
  fixture: FxFixtureSet,
  resolveGap: (r: FxRequirementIdentity) => string,
  reviewed: Reviewed,
  artifacts: Artifacts,
  log: Log,
): Promise<void> {
  const fx = fixture.artifacts.resumeVariant;
  if (!fx) return;
  const repo = createResumeVariantsRepository(db);
  const inputs = await createResumeDocumentsRepository(db).getComposeInputs(userId, reportId);
  const skillByName = new Map(inputs.skills.map((s) => [s.name, s.skillId]));
  const projectByName = new Map(inputs.projects.map((p) => [p.name, p.projectId]));
  const matchExperience = (label: string): string | null =>
    inputs.experiences.find((e) => label.includes(e.company) && label.includes(e.title))
      ?.experienceId ?? null;

  await repo.persistTailoringOutcome(userId, reportId, [toRunInsert(fx.run)], false, {
    renderedMarkdown: fx.variant.renderedMarkdown,
    entries: fx.entries.map((e) => ({
      section: e.entry.section,
      position: e.entry.position,
      profileSkillId: e.entry.section === 'skill' ? (skillByName.get(e.entry.label) ?? null) : null,
      profileProjectId:
        e.entry.section === 'project' ? (projectByName.get(e.entry.label) ?? null) : null,
      profileExperienceId: e.entry.section === 'experience' ? matchExperience(e.entry.label) : null,
      label: e.entry.label,
      detail: e.entry.detail,
      emphasis: e.entry.emphasis,
      reason: e.entry.reason,
      citationGapIds: e.citations.map(resolveGap),
    })),
  });
  const variant = await repo.findVariantForReport(userId, reportId);
  if (!variant) throw new Error('resume variant did not persist');
  const status = reviewed('resumeVariant');
  if (status === 'reviewed') await repo.markVariantReviewed(userId, variant.variant.id, null);
  artifacts.push({ family: 'resumeVariant', reviewStatus: status });
  log(`  resume-variant seeded (${status})`);
}

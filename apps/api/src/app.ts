import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import {
  checkDbReady,
  createApplicationsRepository,
  createCriteriaAdjustmentsRepository,
  createDb,
  createDemoBlueprintsRepository,
  createExercisesRepository,
  createExtractionsRepository,
  createFitReportsRepository,
  createGapsRepository,
  createImprovementPlansRepository,
  createApplicationGameplansRepository,
  createInterviewPrepsRepository,
  createLearningPlansRepository,
  createMasteryEvidenceRepository,
  createCaseStudiesRepository,
  createPostingsRepository,
  createProfileFactsRepository,
  createProfileRepository,
  createResumeDocumentsRepository,
  createResumeVariantsRepository,
  createSearchCriteriaRepository,
  createSessionsRepository,
  createSkillUpgradesRepository,
  createUsersRepository,
  type Db,
} from '@careerforge/db';
import { createAnthropicProvider, type LlmProvider } from '@careerforge/llm';

import { type Env } from './env.ts';
import { createAuthService } from './modules/auth/auth.service.ts';
import { registerAuthGuard } from './modules/auth/auth.hooks.ts';
import {
  registerDemoDisabledGuard,
  registerDemoRateLimit,
  registerDemoRobots,
} from './modules/demo/demo.hooks.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { type Passwords, passwords as realPasswords } from './modules/auth/passwords.ts';
import {
  createFixedWindowRateLimiter,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  type RateLimiter,
} from './modules/auth/rate-limit.ts';
import {
  createProfileImportService,
  createProfileService,
} from './modules/profile/profile.service.ts';
import { profileRoutes } from './modules/profile/profile.routes.ts';
import { createCriteriaService } from './modules/criteria/criteria.service.ts';
import { criteriaRoutes } from './modules/criteria/criteria.routes.ts';
import { createPostingsService } from './modules/postings/postings.service.ts';
import { postingsRoutes } from './modules/postings/postings.routes.ts';
import { createExtractionService } from './modules/extraction/extraction.service.ts';
import { extractionRoutes } from './modules/extraction/extraction.routes.ts';
import { createFitService } from './modules/fit/fit.service.ts';
import { fitRoutes } from './modules/fit/fit.routes.ts';
import { createPlansService } from './modules/plans/plans.service.ts';
import { plansRoutes } from './modules/plans/plans.routes.ts';
import { createLearningService } from './modules/learning/learning.service.ts';
import { learningRoutes } from './modules/learning/learning.routes.ts';
import { createExercisesService } from './modules/exercises/exercises.service.ts';
import { exercisesRoutes } from './modules/exercises/exercises.routes.ts';
import { createMasteryEvidenceService } from './modules/mastery-evidence/mastery-evidence.service.ts';
import { masteryEvidenceRoutes } from './modules/mastery-evidence/mastery-evidence.routes.ts';
import { createReviewQueueService } from './modules/review-queue/review-queue.service.ts';
import { reviewQueueRoutes } from './modules/review-queue/review-queue.routes.ts';
import { createSkillUpgradesService } from './modules/skill-upgrades/skill-upgrades.service.ts';
import { skillUpgradesRoutes } from './modules/skill-upgrades/skill-upgrades.routes.ts';
import { createCaseStudiesService } from './modules/case-studies/case-studies.service.ts';
import { caseStudiesRoutes } from './modules/case-studies/case-studies.routes.ts';
import { createResumeService } from './modules/resume/resume.service.ts';
import { resumeRoutes } from './modules/resume/resume.routes.ts';
import { createResumeComposeService } from './modules/resume-compose/resume-compose.service.ts';
import { resumeComposeRoutes } from './modules/resume-compose/resume-compose.routes.ts';
import { createResumeExportService } from './modules/resume-compose/resume-export.service.ts';
import { resumeExportRoutes } from './modules/resume-compose/resume-compose.export.routes.ts';
import { createResumeAtsService } from './modules/resume-compose/resume-ats.service.ts';
import { resumeAtsRoutes } from './modules/resume-compose/resume-compose.ats.routes.ts';
import { createInterviewPrepService } from './modules/interview-prep/interview-prep.service.ts';
import { interviewPrepRoutes } from './modules/interview-prep/interview-prep.routes.ts';
import { createGameplanService } from './modules/gameplan/gameplan.service.ts';
import { gameplanRoutes } from './modules/gameplan/gameplan.routes.ts';
import { createApplicationsService } from './modules/applications/applications.service.ts';
import { applicationsRoutes } from './modules/applications/applications.routes.ts';
import { createCriteriaAdjustmentsService } from './modules/criteria-adjustments/criteria-adjustments.service.ts';
import { criteriaAdjustmentsRoutes } from './modules/criteria-adjustments/criteria-adjustments.routes.ts';
import { createMarketSignalService } from './modules/market-signal/market-signal.service.ts';
import { marketSignalRoutes } from './modules/market-signal/market-signal.routes.ts';
import { createDemoBlueprintsService } from './modules/demo-blueprints/demo-blueprints.service.ts';
import { demoBlueprintsRoutes } from './modules/demo-blueprints/demo-blueprints.routes.ts';
import { docsRoutes } from './routes/docs.ts';
import { healthRoutes } from './routes/health.ts';
import packageJson from '../package.json' with { type: 'json' };

/** The real, gitignored profile directory at the repo root. */
const REAL_PROFILE_DIR = fileURLToPath(new URL('../../../docs/profile', import.meta.url));

/** Under NODE_ENV=test the default is a nonexistent sentinel, so a test that
 *  forgets to inject `profileDir` fails loudly instead of silently reading
 *  real career data (RISKS P-01: pnpm test must never touch docs/profile/). */
const TEST_PROFILE_DIR_SENTINEL = '/nonexistent-profile-dir--tests-must-inject-profileDir';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle handle for boot-time work (main.ts bootstrap); request-path
     *  data access stays behind repositories wired here. */
    db: Db;
  }
}

/** Test seams; production uses the defaults. An injected dbHandle stays
 *  owned by its caller — buildApp only closes the pool it created itself. */
export interface AppDeps {
  dbHandle?: ReturnType<typeof createDb>;
  /** DB readiness probe for GET /health/ready; defaults to a real `SELECT 1`
   *  against dbHandle. Tests inject a stub to exercise 200/503 without ever
   *  stopping the real database (M13-04 AC 6). */
  checkReady?: () => Promise<boolean>;
  passwords?: Passwords;
  loginRateLimiter?: RateLimiter;
  now?: () => Date;
  /** Directory the profile importer reads (resume.md/skills.md/projects.md). */
  profileDir?: string;
  /** Fires for every registered route — lets tests assert the public-route
   *  allowlist AND the llmDraft (demo-disabled) set are exactly what's expected
   *  (guard-the-guard). */
  onRoute?: (route: {
    method: string | string[];
    url: string;
    public: boolean;
    llmDraft: boolean;
  }) => void;
  /** Destination for pino output — lets tests capture exactly the serialized
   *  log lines that would reach stdout (the no-posting-text-in-logs pin). */
  logStream?: { write(line: string): void };
  /** LLM provider seam (M1-05): tests inject createMockProvider; production
   *  builds the Anthropic adapter iff ANTHROPIC_API_KEY is set, else
   *  extraction serves 503 LLM_NOT_CONFIGURED. */
  llmProvider?: LlmProvider;
}

// M10-02 same-origin SPA routing (D1, amended r2-A1). When the generated SPA
// payload is mounted (WEB_DIST_DIR set), a browser NAVIGATION -- GET/HEAD asking
// for HTML -- must resolve to the SPA shell so deep links / hard refreshes work,
// EVEN on paths that collide with a root-path API route (GET /postings/:id and
// friends). API calls (Accept json or */* or absent) fall through to the real
// (guarded) route byte-for-byte. Paths whose final segment carries a dot are
// static assets (/_nuxt/*, favicon.ico, robots.txt) and are never the shell;
// a few dot-less paths are always-API and named here.
const ALWAYS_API_PATHS = new Set(['/health']);

function isSpaNavigation(method: string, url: string, accept: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!accept.includes('text/html')) return false;
  const path = url.split(/[?#]/)[0] ?? url;
  if (ALWAYS_API_PATHS.has(path)) return false;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/**
 * Builds the Fastify instance from an already-validated Env (main.ts owns the
 * fail-fast parse). Kept separate from listening so tests can `inject()`
 * against the real app.
 */
export async function buildApp(env: Env, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // pino structured JSON at the zod-validated level; every request gets a
    // UUID id (or the caller's x-request-id) carried through all its log lines.
    logger: deps.logStream
      ? { level: env.LOG_LEVEL, stream: deps.logStream }
      : { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // Behind a trusted front (the demo deploy's ALB/App Runner), read the client
    // IP from X-Forwarded-For so per-IP rate limits are real; off everywhere else
    // (local/dev/test) where trusting the header would let request.ip be spoofed.
    trustProxy: env.TRUST_PROXY,
  });

  const production = env.NODE_ENV === 'production';

  // Route zod schemas are the single source of truth (ADR-0002): the zod
  // compilers enforce them at runtime, and @fastify/swagger derives the
  // OpenAPI spec from the same declarations.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Centralized error shape: { error: { code, message } } (ARCHITECTURE §API
  // conventions). The full error — message and stack — goes to the log only,
  // never the response body. In production, 5xx additionally hide the internal
  // message behind a generic one; 4xx are intentional and pass through.
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      // Value-free by construction: paths + zod issue codes ONLY, never
      // issue.message — enum/literal mismatch messages echo the received
      // value, and request bodies (login credentials today, pasted posting
      // text in M1) must never round-trip into a response.
      const context = error.validationContext ?? 'request';
      const details = error.validation
        .map((issue) => `${context}${issue.instancePath}: ${issue.keyword}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: details } });
    }
    // Fastify types thrown values as unknown — narrow before touching fields.
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    request.log.error({ err }, 'request failed');
    const fallbackCode = statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR';
    const code = 'code' in err && typeof err.code === 'string' ? err.code : fallbackCode;
    const hideInternals = production && statusCode >= 500;
    return reply.status(statusCode).send({
      error: {
        code: hideInternals ? 'INTERNAL_SERVER_ERROR' : code,
        message: hideInternals ? 'Internal Server Error' : err.message,
      },
    });
  });

  // M10-02: when a generated SPA payload is mounted (WEB_DIST_DIR set), this
  // holds its entry HTML shell, read once at register time below.
  let spaEntryHtml: string | undefined;

  // Unknown routes use the same error shape as everything else -- EXCEPT a
  // browser navigation to a client-side route (GET/HEAD asking for HTML) when
  // a SPA payload is mounted: that hard-refreshes into the entry shell (200)
  // so deep links resolve. API clients (Accept json or */*) keep the exact
  // JSON 404 contract byte-for-byte.
  app.setNotFoundHandler((request, reply) => {
    if (
      spaEntryHtml !== undefined &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      (request.headers.accept ?? '').includes('text/html')
    ) {
      return reply
        .status(200)
        .header('cache-control', 'no-cache')
        .type('text/html')
        .send(spaEntryHtml);
    }
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });

  // Composition root, wired routes → services → repositories (Drizzle-backed
  // repositories from packages/db).
  const ownsDbHandle = deps.dbHandle === undefined;
  const dbHandle = deps.dbHandle ?? createDb(env.DATABASE_URL);
  if (ownsDbHandle) {
    app.addHook('onClose', () => dbHandle.pool.end());
  }
  app.decorate('db', dbHandle.db);

  const passwords = deps.passwords ?? realPasswords;
  const authService = await createAuthService({
    users: createUsersRepository(dbHandle.db),
    sessions: createSessionsRepository(dbHandle.db),
    passwords,
    now: deps.now,
  });
  const loginRateLimiter =
    deps.loginRateLimiter ??
    createFixedWindowRateLimiter({
      maxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    });
  const profileRepository = createProfileRepository(dbHandle.db);
  const profileFactsRepository = createProfileFactsRepository(dbHandle.db);
  const criteriaRepository = createSearchCriteriaRepository(dbHandle.db);
  const profileImportService = createProfileImportService({
    profileDir:
      deps.profileDir ?? (env.NODE_ENV === 'test' ? TEST_PROFILE_DIR_SENTINEL : REAL_PROFILE_DIR),
    profile: profileRepository,
    facts: profileFactsRepository,
    criteria: criteriaRepository,
  });
  const profileService = createProfileService({
    profile: profileRepository,
    facts: profileFactsRepository,
  });
  const postingsRepository = createPostingsRepository(dbHandle.db);
  const extractionsRepository = createExtractionsRepository(dbHandle.db);
  const fitReportsRepository = createFitReportsRepository(dbHandle.db);
  const gapsRepository = createGapsRepository(dbHandle.db);
  // Shared across six consumers (one definition of "the user's exercises"):
  // the exercises module in full, the learning-plan embed, the mastery-evidence
  // ownership check (narrowed to ExerciseOwnershipRead), the review queue
  // (narrowed to ExerciseReviewRead, M3-05), the skill-upgrades service
  // (narrowed to ExerciseUpgradeRead, M3-06), and the case-studies service
  // (narrowed to ExerciseCaseStudyRead, M4-01).
  const exercisesRepository = createExercisesRepository(dbHandle.db);
  // Shared across six consumers (one definition of "the user's evidence"): the
  // mastery-evidence write routes, the exercises completion gate (D1, narrowed
  // to hasRequiredEvidence), the learning-plan embed (D4, narrowed to
  // listEvidenceByExerciseIds), the review queue (same narrow embed read,
  // filtered to `revisited` in its service, M3-05), the skill-upgrades service
  // (M3-06), and the case-studies service (M4-01) — the last three all via the
  // narrow listEvidenceByExerciseIds embed read.
  const masteryEvidenceRepository = createMasteryEvidenceRepository(dbHandle.db);
  // Shared across two consumers (one definition of "the user's learning
  // plans"): the learning module in full, and the interview-prep service
  // narrowed to LearningPlanPointerRead (the read-time wire pointer, M3-04).
  const learningPlansRepository = createLearningPlansRepository(dbHandle.db);
  // The unarchive restore law reads extraction runs AND fit reports (M1-10
  // widening) — same repository instances as the extraction/fit services,
  // one definition of "has artifacts".
  const postingsService = createPostingsService({
    postings: postingsRepository,
    extractions: extractionsRepository,
    fitReports: fitReportsRepository,
  });
  // Shared across two consumers (one definition of "the user's applications"):
  // the applications module in full, and the M4-02 criteria-adjustments service
  // (narrowed to listForUser + listStageChangeEvents — its outcome-engine input).
  const applicationsRepository = createApplicationsRepository(dbHandle.db);
  const applicationsService = createApplicationsService({
    applications: applicationsRepository,
    // The create path's ownership check reads postings — same repository
    // instance as the postings service, one definition of "the user's rows".
    postings: postingsRepository,
    now: deps.now,
  });
  const criteriaAdjustmentsService = createCriteriaAdjustmentsService({
    criteria: criteriaRepository,
    criteriaAdjustments: createCriteriaAdjustmentsRepository(dbHandle.db),
    applications: applicationsRepository,
    // The engine reads each posting's eligible requirements — same repository
    // instance as the extraction/fit services (one definition of "the user's
    // extractions").
    extractions: extractionsRepository,
  });
  const llmProvider =
    deps.llmProvider ??
    (env.ANTHROPIC_API_KEY !== undefined
      ? createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL })
      : undefined);
  const extractionService = createExtractionService({
    postings: postingsRepository,
    extractions: extractionsRepository,
    provider: llmProvider,
    ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
  });

  const { onRoute } = deps;
  if (onRoute) {
    app.addHook('onRoute', (route) =>
      onRoute({
        method: route.method,
        url: route.url,
        // Read live, not snapshotted: scoped onRoute hooks that run AFTER
        // this root-level collector can still finalize config — the /docs
        // plugin marks its routes public that way. A snapshot here would
        // hide exactly the exemptions the allowlist test exists to see.
        get public() {
          return route.config?.public === true;
        },
        get llmDraft() {
          return route.config?.llmDraft === true;
        },
      }),
    );
  }

  // Order is load-bearing: cookie parsing is an onRequest hook, so its
  // register must be awaited before the guard hook is added, and the guard
  // must exist before any guarded route registers. @fastify/swagger must be
  // registered before the routes whose schemas it collects; it adds no routes
  // itself (only the in-memory app.swagger() builder), so it is safe in every
  // env — the /docs UI below is the only exposed surface.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'CareerForge API', version: packageJson.version },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifyCookie);
  // CORS (M0-07's parked wiring, came due M0-10): the SPA at WEB_APP_ORIGIN
  // is cross-origin to this API (localhost:4300 → :4301), so browsers demand
  // these response headers before JS may read anything, and preflight JSON
  // POSTs. `origin` is the exact validated-env value — the same single
  // definition of "the web app" the CSRF check below uses — never a
  // reflection/regex/true. The one-element-ARRAY form is deliberate: a bare
  // string is emitted unconditionally (no comparison at all — proven by this
  // pin failing against it), while the array compares exactly and an unlisted
  // origin gets NO allow-origin header.
  // `credentials: true` lets the cf_session cookie ride (same-site across
  // ports, so Lax permits it). Register order is load-bearing and is itself
  // the auth exemption: @fastify/cors answers OPTIONS preflights in its own
  // onRequest hook, which must run BEFORE the guard's hook — preflights never
  // carry cookies, so this is the /health-style deliberate opt-out for
  // preflight OPTIONS (pinned in auth.routes.test.ts with the allowlist).
  // It registers no routes; the pinned route sets stay exact.
  await app.register(fastifyCors, {
    origin: [new URL(env.WEB_APP_ORIGIN).origin],
    credentials: true,
  });

  // M10-02 same-origin static serving of the generated SPA payload. Active
  // ONLY when WEB_DIST_DIR is set (the demo container); unset in dev/test/CI
  // = API-only, zero behavior change. The static surface is PUBLIC (the payload
  // is the login shell of an already-public codebase, reachable without a
  // session); explicit API routes always beat the wildcard (find-my-way
  // precedence). Only the pure-static `nuxt generate` output is served --
  // `.output/server/**` (Nitro) is never shipped.
  if (env.WEB_DIST_DIR !== undefined) {
    // Fail fast at boot if the payload's entry shell is missing/unreadable --
    // a misconfigured dist dir is a boot error, not a lazy per-request 500.
    const shellHtml = readFileSync(join(env.WEB_DIST_DIR, 'index.html'), 'utf8');
    spaEntryHtml = shellHtml;
    // Browser navigations resolve to the shell BEFORE the guard runs, so deep
    // links / hard refreshes work even on paths that collide with a guarded API
    // route (GET /postings/:id etc.). GET/HEAD + shell bytes only = no data
    // exposure; mutations, CSRF, cookies, and guard logic are untouched, and API
    // calls (Accept json / */* / absent) fall through byte-for-byte.
    app.addHook('onRequest', async (request, reply) => {
      if (!isSpaNavigation(request.method, request.url, request.headers.accept ?? '')) return;
      return reply
        .status(200)
        .header('cache-control', 'no-cache')
        .type('text/html')
        .send(shellHtml);
    });
    // The auth guard is a global onRequest hook, so the static wildcard route
    // needs the same `config.public` opt-out every other public route uses.
    // @fastify/static exposes no per-route config, so stamp it as it registers.
    app.addHook('onRoute', (routeOptions) => {
      if (routeOptions.url === '/*') {
        routeOptions.config = { ...routeOptions.config, public: true };
      }
    });
    await app.register(fastifyStatic, {
      root: env.WEB_DIST_DIR,
      index: false,
      wildcard: true,
      setHeaders(reply, filePath) {
        // Content-hashed assets under /_nuxt/ are immutable; everything else
        // (the entry shell above all) is no-cache, or a stale shell would pin
        // an old asset graph.
        reply.header(
          'cache-control',
          filePath.includes(`${sep}_nuxt${sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  }

  registerAuthGuard(app, { auth: authService, webAppOrigin: env.WEB_APP_ORIGIN });
  // AFTER the guard: an unauthenticated call to an llmDraft route in demo still
  // gets 401, not the demo 403. No-op when DEMO_MODE is off.
  registerDemoDisabledGuard(app, { demoMode: env.DEMO_MODE });
  // Per-IP mutation throttle for the public demo (login exempt). No-op off-demo.
  registerDemoRateLimit(app, { demoMode: env.DEMO_MODE });
  // Public robots.txt + every-response noindex header, demo-runtime only. No
  // route and no hook off-demo, so a real instance is byte-for-byte unchanged.
  registerDemoRobots(app, { demoMode: env.DEMO_MODE });

  await app.register(
    healthRoutes({
      demoMode: env.DEMO_MODE,
      checkReady: deps.checkReady ?? (() => checkDbReady(dbHandle)),
    }),
  );
  await app.register(
    authRoutes({ auth: authService, loginRateLimiter, secureCookies: production }),
  );
  await app.register(profileRoutes({ importer: profileImportService, profile: profileService }));
  await app.register(
    criteriaRoutes({ criteria: createCriteriaService({ criteria: criteriaRepository }) }),
  );
  await app.register(postingsRoutes({ postings: postingsService }));
  await app.register(extractionRoutes({ extraction: extractionService }));
  await app.register(
    fitRoutes({
      fit: createFitService({
        postings: postingsRepository,
        extractions: extractionsRepository,
        criteria: criteriaRepository,
        profile: profileRepository,
        facts: profileFactsRepository,
        fitReports: fitReportsRepository,
        gaps: gapsRepository,
      }),
    }),
  );
  await app.register(
    plansRoutes({
      plans: createPlansService({
        plans: createImprovementPlansRepository(dbHandle.db),
        gaps: gapsRepository,
        profile: profileRepository,
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    learningRoutes({
      learning: createLearningService({
        learning: learningPlansRepository,
        gaps: gapsRepository,
        profile: profileRepository,
        exercises: exercisesRepository,
        masteryEvidence: masteryEvidenceRepository,
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    exercisesRoutes({
      exercises: createExercisesService({
        exercises: exercisesRepository,
        masteryEvidence: masteryEvidenceRepository,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    masteryEvidenceRoutes({
      masteryEvidence: createMasteryEvidenceService({
        evidence: masteryEvidenceRepository,
        exercises: exercisesRepository,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    reviewQueueRoutes({
      reviewQueue: createReviewQueueService({
        exercises: exercisesRepository,
        masteryEvidence: masteryEvidenceRepository,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  // M3-06: deterministic evidence -> profile upgrades. Reuses the shared
  // exercises/mastery/gaps/profile repositories (narrowed to read-only views);
  // owns its skill_upgrades repository (the write path).
  await app.register(
    skillUpgradesRoutes({
      skillUpgrades: createSkillUpgradesService({
        skillUpgrades: createSkillUpgradesRepository(dbHandle.db),
        exercises: exercisesRepository,
        masteryEvidence: masteryEvidenceRepository,
        gaps: gapsRepository,
        profile: profileRepository,
      }),
    }),
  );
  // M4-01: deterministic exercise -> case-study draft. Reuses the shared
  // exercises/mastery repositories (narrowed to read-only views); owns its
  // case_studies repository (the write path). Publishes NOTHING — the module
  // wall stands; authoring portfolio content is a separate manual step.
  await app.register(
    caseStudiesRoutes({
      caseStudies: createCaseStudiesService({
        caseStudies: createCaseStudiesRepository(dbHandle.db),
        exercises: exercisesRepository,
        masteryEvidence: masteryEvidenceRepository,
      }),
    }),
  );
  await app.register(
    resumeRoutes({
      resume: createResumeService({
        variants: createResumeVariantsRepository(dbHandle.db),
        gaps: gapsRepository,
        profile: profileRepository,
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    resumeComposeRoutes({
      resumeCompose: createResumeComposeService({
        documents: createResumeDocumentsRepository(dbHandle.db),
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  // M6-05: export + parse-audit over the composed document's canonical snapshot.
  await app.register(
    resumeExportRoutes({
      resumeExport: createResumeExportService({
        documents: createResumeDocumentsRepository(dbHandle.db),
      }),
    }),
  );
  // M6-06: ats-coverage diagnostic over the composed document's canonical snapshot.
  await app.register(
    resumeAtsRoutes({
      resumeAts: createResumeAtsService({
        documents: createResumeDocumentsRepository(dbHandle.db),
      }),
    }),
  );
  await app.register(
    interviewPrepRoutes({
      interviewPrep: createInterviewPrepService({
        interviews: createInterviewPrepsRepository(dbHandle.db),
        learningPlanPointers: learningPlansRepository,
        profile: profileRepository,
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(
    gameplanRoutes({
      gameplan: createGameplanService({
        gameplans: createApplicationGameplansRepository(dbHandle.db),
        profile: profileRepository,
        provider: llmProvider,
        ...(deps.now ? { now: () => (deps.now as () => Date)().getTime() } : {}),
      }),
    }),
  );
  await app.register(applicationsRoutes({ applications: applicationsService }));
  await app.register(
    criteriaAdjustmentsRoutes({ criteriaAdjustments: criteriaAdjustmentsService }),
  );
  // M9-02: whole-cohort market-signal aggregation (deterministic, read-only, no LLM).
  await app.register(
    marketSignalRoutes({
      marketSignal: createMarketSignalService({ gaps: gapsRepository }),
    }),
  );
  // M9-04: deterministic demo blueprints for market-signal BUILD groups. Reuses
  // the shared gaps repository (recompute + ownership) and the exercises
  // repository (narrowed to the read-only linked-exercises view); owns its
  // demo_blueprints repository (the write path). NO LLM, NO UI - the four
  // section texts are the artifact.
  await app.register(
    demoBlueprintsRoutes({
      demoBlueprints: createDemoBlueprintsService({
        demoBlueprints: createDemoBlueprintsRepository(dbHandle.db),
        gaps: gapsRepository,
        exercises: exercisesRepository,
      }),
    }),
  );
  // Dev-only docs UI (M0-09): absent in production means the routes 404 and
  // their auth exemption never exists there.
  if (!production) await app.register(docsRoutes);

  return app;
}

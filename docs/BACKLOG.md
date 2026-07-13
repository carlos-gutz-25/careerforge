# CareerForge — Backlog

**Status:** Draft for review · **Last updated:** 2026-07-12

Stories are grouped by milestone (M0–M4, matching [PLAN.md](./PLAN.md)) and ordered by priority within each. Sizes: **S** (≤ half day) · **M** (~1 day) · **L** (2–3 days). Statuses: `not started` → `in progress` → `done` (update on completion — CLAUDE.md rule). Definition of done for every story: code + tests + migration (if schema) + docs updated, and `pnpm typecheck && pnpm lint && pnpm test` green.

---

## M0 — Foundation (Weeks 1–2)

### M0-01 · Privacy guardrails before first commit · **S** · `done` *(2026-07-12: pre-push verification passed — clean `git ls-files`, full-history gitleaks scan, no private paths in any commit; repo published to github.com/carlos-gutz-25/careerforge. CI profile-guard green on first push; the gitleaks job errors on the initial push only because the root commit has no parent for its diff range — valid on subsequent pushes.)*

> ⚠️ Must be completed before anything is committed to the public repo.

- **Given** a fresh clone, **then** `.gitignore` excludes `docs/profile/`, `.env`, and local data dumps, and `git status` shows none of them.
- `docs/profile.example/` exists with a fully fictional profile (resume, projects, links, job criteria) mirroring the real structure.
- gitleaks runs as a pre-commit hook and in CI; a seeded fake secret in a test branch is caught.
- README states the public-repo/private-data policy.

### M0-02 · pnpm workspace scaffold · **M** · `done` *(2026-07-12: 8 workspaces + shared config in packages/config; typecheck/lint/test green from root; boundary enforcement verified by negative test — undeclared dep fails tsc, restricted import fails eslint)*

- Workspace contains `apps/api`, `apps/web`, `apps/portfolio`, `packages/{core,db,llm,scoring,config}` with `packages/config` providing shared tsconfig + eslint consumed by all.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` run from the root across all workspaces and pass (empty tests OK).
- Root README documents layout and commands.

### M0-03 · Local infrastructure & env validation · **S** · `done` *(2026-07-13: Postgres 16 healthy via compose; persistence verified — probe table survived `down`/`up` on the `pgdata` named volume; boot fails fast naming the bad variable (verified for missing `DATABASE_URL` and non-numeric `API_PORT`); env schema in `apps/api/src/env.ts` is the single source of truth, with a test asserting every schema key is documented in `.env.example`)*

- `docker compose up -d` starts Postgres 16 with a persistent volume.
- `.env.example` documents every variable; env is zod-validated at API boot; boot fails fast with a clear message on any missing/invalid variable.

### M0-04 · Fastify skeleton with layering · **M** · `not started`

- `GET /health` returns `{ status, version }`; pino structured logs with request IDs; centralized error handler returns `{ error: { code, message } }` and never leaks stack traces in production mode.
- Example route → service → repository slice exists as the layering reference (no SQL outside `packages/db`).
- Integration test hits `/health` through a real Fastify instance.

### M0-05 · CI pipeline · **S** · `not started`

- GitHub Actions runs typecheck + lint + test + gitleaks on every PR and push to main; a red check blocks merge; badge in README.

### M0-06 · Drizzle setup + schema v1 · **M** · `not started`

- Drizzle + drizzle-kit configured; `pnpm db:migrate` applies checked-in SQL migrations; migration files reviewed in PR.
- Schema v1: `users`, `sessions`, `profile_skills`, `profile_experiences`, `profile_projects`, `search_criteria`, `job_postings`, `applications`, `application_events` (per ARCHITECTURE.md ERD).
- Repository integration tests run against dockerized Postgres.

### M0-07 · Session auth · **M** · `not started`

- Single user seeded from env at first boot (argon2id hash). `POST /auth/login` sets an HTTP-only `SameSite=Lax` signed cookie backed by a `sessions` row; `POST /auth/logout` revokes it; `GET /auth/me` returns the user.
- All non-auth/non-health routes 401 without a valid session; login is rate-limited; session rotates on login and expires.
- Tests cover: wrong password, expired session, rotation, rate limiting.

### M0-08 · Profile importer · **M** · `not started`

- `POST /profile/import` (and a CLI script) parses `docs/profile/` markdown into profile tables; running against `docs/profile.example/` seeds the demo profile; import is idempotent (re-import updates, doesn't duplicate).
- Skills carry `level` (expert/solid/rusty/learning), `years`, `last_used`; projects carry `provenance` (professional / personal / personal_ai_assisted).
- Parse failures report file + line, never silently skip. Tests use the example profile only.

### M0-09 · OpenAPI docs · **S** · `not started`

- Route zod schemas generate an OpenAPI spec served at `/docs` in dev; spec is committed or CI-verified so drift fails the build.

### M0-10 · Nuxt web shell · **M** · `not started`

- `apps/web` (Nuxt 4, SPA mode) with login page, authenticated layout, profile view rendering imported data, and a typed API client (types from `packages/core`).
- Unauthenticated access redirects to login; component test covers the auth guard.

---

## M1 — Job Intelligence MVP (Weeks 3–6)

### M1-01 · Posting ingestion (paste-only) · **M** · `not started`

- `POST /postings` accepts pasted text + optional metadata (company, title, source note); text is stored raw, content-hashed for dedupe (duplicate paste → existing record returned with notice), and size-capped with a clear error.
- **Posting text is treated as untrusted from this moment**: stored verbatim, always display-escaped downstream.

### M1-02 · Posting list & detail UI · **M** · `not started`

- List with status (new/extracted/scored/archived), company, title, ingest date; detail renders raw text as escaped plain text (an XSS payload in a posting renders inert — test exists); status transitions available.

### M1-03 · Application tracking · **M** · `not started`

- Application created from a posting; stages: considering → applied → screen → interview → offer / rejected / withdrawn; events log stage changes, notes, and outcomes with dates; list view filterable by stage.

### M1-04 · `packages/llm`: provider interface + Anthropic adapter + prompt registry · **L** · `not started`

- `LlmProvider` interface per ADR-0005; Anthropic adapter with model/temperature from config; mocked provider for tests.
- Prompt registry: prompts are TS modules with stable versioned IDs; every call records prompt_id, model, token usage, latency, raw response.
- No module outside `packages/llm` imports a provider SDK (lint rule or dependency check).

### M1-05 · Requirement extraction pipeline · **L** · `not started`

- `POST /postings/:id/extract` runs `extract-requirements@v1`: posting text passed as delimited data with a per-request random boundary token (ADR-0006 layer 1), single-turn, no tools, JSON-schema-constrained.
- Output zod-validated (one retry, then `schema_failed`); requirements stored with kind (must/nice), category, text, `source_quote`, confidence; an `extraction_run` row stores model, prompt_id, raw response, status.
- Re-extraction is explicit and append-only; cached by `content_hash × prompt_id`.

### M1-06 · Evidence verification · **M** · `not started`

- Every `source_quote` is whitespace-normalized string-matched against the stored posting; mismatches set `quote_verified = false` and mark the run `flagged`; flagged runs are visually prominent in the UI.
- Table-driven tests: exact match, whitespace variance, fabricated quote, near-miss paraphrase (must flag).

### M1-07 · Prompt-injection test suite · **M** · `not started`

- Fixture corpus of adversarial postings (instruction override, role-play coercion, fake delimiters, HTML/script, unicode smuggling, system-prompt probes) committed under `packages/llm`.
- CI (mocked provider) asserts: system prompts contain no posting text, boundary tokens are random per request, schema failures and fabricated quotes flag correctly, extracted text renders escaped.
- A documented manual live-model pass is required for every prompt-version bump.

### M1-08 · Structured search criteria · **M** · `not started`

- The hard filters, positive/negative signals, and comp bounds from `docs/profile/job-criteria.md` (YAML blocks) are imported into `search_criteria`; editable via `GET/PUT /criteria`; example-profile criteria used in tests.

### M1-09 · Deterministic fit engine · **L** · `not started`

- `packages/scoring` (pure, no LLM imports — enforced) computes the 7 sub-scores: **min_quals, technical, domain, seniority, comp_location, priority, stretch**, each 0–1 with a rule-generated rationale and evidence links (requirement ↔ profile item, quotes from both sides, strength direct/partial/adjacent).
- Same inputs → identical output (property test); table-driven tests cover each dimension including edge cases (no comp info in posting, seniority mismatch, hard-filter hit).
- Hard-filter violations (from search_criteria) surface as an explicit exclusion verdict, not a silent low score.

### M1-10 · Fit report UI · **M** · `not started`

- `POST /postings/:id/fit` produces a draft report; UI shows all 7 sub-scores with rationale and clickable evidence (posting quote + profile quote side by side); no single merged "match %" is displayed without the breakdown; report can be marked reviewed with notes.

### M1-11 · Gap classification with override · **M** · `not started`

- Unmet/partially-met requirements classified into **have / have-but-undemonstrated / needs-refresh / genuine-gap / low-priority** with rationale; classification rules live in `packages/scoring`; Carlos can override any classification (recorded as `user_overridden`); overrides survive re-scoring.

### M1-12 · Improvement plan drafts · **M** · `not started`

- `POST /fit-reports/:id/improvement-plan` generates a draft plan (LLM-assisted) from **verified structured data only** (never raw posting text); every plan item cites the gap and evidence that motivated it; plans are `draft` until reviewed; items have priority + status.

### M1-13 · Dogfood gate: tool is useful to the active search · **S** · `not started`

> Applying is NOT gated on this story — real applications have been running manually since week 1 (PLAN §5 parallel track). This gate verifies the tool improves that already-running search.

- ≥5 real postings from the active search scored end to end; fit reports have informed ≥2 in-flight applications (targeting, prep, or go/no-go decisions); friction log converted to backlog items; M1 retro note added to docs (including the Q5 resume-tailoring decision). **This story gates M2.**

---

## M2 — Portfolio MVP (Weeks 7–9)

### M2-01 · Portfolio scaffold + deploy pipeline · **M** · `not started`

- `apps/portfolio` (Nuxt SSG + Nuxt Content) builds statically with zero platform-package imports (enforced); CI deploys to the chosen static host on merge to main; custom domain + HTTPS live (domain choice: OPEN-QUESTIONS Q2).

### M2-02 · Design system & accessible foundations · **L** · `not started`

- Design tokens (type scale, spacing, color with AA contrast), semantic landmarks, skip link, visible focus states, reduced-motion support, light/dark mode; keyboard-only navigation works across the site.

### M2-03 · CI quality gates · **M** · `not started`

- Lighthouse CI budgets enforced on PRs (targets: performance ≥ 95, accessibility = 100, best-practices ≥ 95, SEO ≥ 95 on key pages); axe automated checks pass with zero violations; internal link check passes. A failing budget blocks merge.

### M2-04 · Case-study template + honesty labeling · **M** · `not started`

- Content schema enforces sections: problem, constraints, architecture, tradeoffs, testing, results, what-I'd-change; every case study displays a provenance label (**professional / personal / personal, AI-assisted**); results only state substantiated metrics (sourced from `docs/profile/projects.md` or the repo itself).

### M2-05 · Heartland case studies (×3) · **L** · `not started`

- Analytics platform migration, Redis/Snowflake caching, pricing rules engine — written from projects.md without proprietary details (employer-sensitivity check: OPEN-QUESTIONS Q7); each passes the template schema and includes an honest "what I'd change."

### M2-06 · Love's + Nintendo case studies · **M** · `not started`

- Mobile commerce/Showers platform and computer-vision test automation, same standards as M2-05.

### M2-07 · Binventory + CareerForge case studies · **M** · `not started`

- Binventory case study labeled *personal, AI-assisted*, scoped per OPEN-QUESTIONS Q3; CareerForge case study links the public repo, ADRs, and CI as living evidence and is marked "in progress" honestly.

### M2-08 · Home, about, resume pages · **M** · `not started`

- Home communicates the senior backend-leaning full-stack positioning (from job-criteria.md's positioning statement); resume page mirrors real resume content **reviewed for public exposure** (no phone number or personal address — contact via form/email link); about covers the Nintendo→Love's→Heartland arc.

### M2-09 · Publish & verification pass · **S** · `not started`

- Live site verified: Lighthouse budgets on production URL, axe zero violations, keyboard-only + screen-reader (VoiceOver) pass documented, mobile check on a real device, OpenGraph/meta correct. Verification results recorded in the repo.

---

## M3 — Skill Accelerator (Weeks 10–11)

### M3-01 · Learning plans from gaps · **M** · `not started`

- Select gaps (across postings) → `POST /learning-plans` drafts a plan citing, for each gap, the posting evidence that created it; recurring gaps across multiple postings rank higher; plans are draft-until-reviewed.

### M3-02 · Exercises linked to gaps · **M** · `not started`

- Exercises (kata / project / writeup / interview_drill) belong to a learning plan and link to the gaps they address; status planned → in_progress → complete; a gap shows its exercises and vice versa.

### M3-03 · Mastery evidence · **M** · `not started`

- Evidence records of kind **implemented / tested / explained / revisited** with artifact links (repo, test run, writeup) and dates; an exercise cannot be `complete` without at least implemented + tested evidence; a skill claim is only upgraded when evidence exists — passive reading counts for nothing (enforced in the model, not just the UI).

### M3-04 · Interview-prep packs · **M** · `not started`

- `POST /postings/:id/interview-prep` drafts likely interview questions derived from that posting's verified requirements, with talking points that cite only real profile evidence; where a gap exists the prep says so honestly and points to the learning plan instead of inventing experience; draft-until-reviewed.

### M3-05 · Revisit scheduling · **S** · `not started`

- Completed exercises enter a spaced review queue (e.g., 7/30/90 days); `GET /review-queue` lists due revisits; completing a revisit records `revisited` evidence.

### M3-06 · Evidence → profile upgrades · **S** · `not started`

- When an exercise completes with full evidence, the linked `profile_skills` level upgrade is **suggested** and applied only on Carlos's confirmation; the audit trail (which evidence justified which upgrade) is preserved.

---

## M4 — Integrations & Hardening (Week 12)

### M4-01 · Exercise → case-study draft · **M** · `not started`

- A completed exercise with evidence can generate a case-study draft pre-filled with the template sections, linked artifacts, and *personal / AI-assisted* provenance; publishing remains a manual portfolio-content step.

### M4-02 · Outcomes → matching feedback · **M** · `not started`

- Application outcomes (screens, rejections, offers) produce **suggested** adjustments to search-criteria weights (e.g., dimensions that correlate with progression); suggestions are shown with their supporting data and applied only on confirmation — the loop closes with a human in it.

### M4-03 · Platform deployment ADR · **S** · `not started`

- ADR-0008 written: decide platform hosting (stay local / Azure / PaaS) with cost and career rationale; implement only if the decision is trivial to execute inside the week.

### M4-04 · Docs refresh, v2 backlog, retro · **S** · `not started`

- README, ARCHITECTURE, and BACKLOG updated to reality; v2 candidates recorded (resume tailoring/export, collection with legal guardrails, multi-user, email/calendar integration); 12-week retro written.

---

## Icebox (explicitly deferred)

- Automated job collection (legal guardrails per RISKS.md L-01 are prerequisites, plus an ADR)
- Resume tailoring/export per posting (pending OPEN-QUESTIONS Q5)
- Multi-user support, hosted platform, email/calendar integration, browser extension for one-click paste

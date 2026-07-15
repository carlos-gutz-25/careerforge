# CareerForge — Backlog

**Status:** Draft for review · **Last updated:** 2026-07-13

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

### M0-04 · Fastify skeleton with layering · **M** · `done` *(2026-07-13: `/health` serves `{ status, version }` with version from package.json; pino JSON logs carry a UUID reqId (or the caller's `x-request-id`); error-body contract ratified as canonical (2026-07-13) and verified live in both modes — stacks never appear in any response body; dev 500s may expose `error.message`, production 500s are fully generic, intentional 4xx messages pass through in both modes; example slice `GET /example/items[/:id]` is the layering reference — stays in-memory by design (swap retired at M0-06: no example table in the nine-table schema v1; real repositories live in packages/db); 8 integration tests via `fastify.inject`)*

- `GET /health` returns `{ status, version }`; pino structured logs with request IDs; centralized error handler returns `{ error: { code, message } }` and never leaks stack traces in production mode.
- Example route → service → repository slice exists as the layering reference (no SQL outside `packages/db`).
- Integration test hits `/health` through a real Fastify instance.

### M0-05 · CI pipeline · **S** · `done` *(2026-07-13: `ci` workflow runs typecheck/lint/test as matrix jobs on every push and PR to master — Node from `.nvmrc`, pnpm via `corepack enable` from the `packageManager` pin (pnpm/action-setup rejected: both its self-installer and standalone paths broke on the runner), pnpm store cached, concurrency group cancels superseded runs; verified green in run 29286254779 alongside the existing gitleaks + profile-guard jobs; checkout bumped to v7 across workflows (parked as "v5" in M0-03, but v7 was current by execution time); dependency-cruiser DEFERRED with adoption criteria in README (parked from M0-02); badges in README; ruleset `master-protection` requires all five checks on PRs with repository-admin bypass, so solo direct pushes still land — "red check blocks merge" holds for any non-bypassed merge)*

- GitHub Actions runs typecheck + lint + test + gitleaks on every PR and push to main; a red check blocks merge; badge in README.

### M0-06 · Drizzle setup + schema v1 · **M** · `done` *(2026-07-13: nine tables exactly per story scope, plain SQL migration `0000_luxuriant_beast.sql` checked in and human-reviewed (gate V2 walkthrough, approved as applied baseline); enum-like columns are text + CHECK derived from `packages/core` as-const value sets (pg enums rejected — ALTER TYPE vs forward-only ADR-0003; TS enums banned under type stripping); ratified decisions: `sessions` shape invented (uuid id, unique token_hash, expires_at — not in original ERD), user_id added to applications/application_events per ADR-0007, repository interfaces co-located with Drizzle impls in packages/db ($inferSelect row types), Postgres-down = fail-fast with colima/compose hint, no skip; users+sessions repositories with integration tests against dockerized Postgres — global setup derives careerforge_test from DATABASE_URL, creates it, migrates; TRUNCATE-between-tests isolation with serial test files (suite slowness = the ADR-0004-style trigger to revisit); `pnpm db:seed` = idempotent fictional Alex Rivera profile only; CI test job split from the matrix with a postgres:16 service, check name `test` unchanged for the ruleset. Dispositions — PARKED: add indexes on FK columns (plain user_id FKs, application_events.application_id — UNIQUEs are already indexed) when EXPLAIN shows sequential scans on a real query path; earliest plausible M1-09/M1-10. PARKED: natural-key uniqueness on profile tables for M0-08's idempotent import. DOCUMENTED: esbuild build scripts denied in pnpm-workspace.yaml allowBuilds (postinstall is a perf shim; drizzle-kit verified working without it). DISMISSED: drizzle-kit's deprecated @esbuild-kit subdeps (upstream, warning-only). RETIRED: M0-04's example-slice swap promise — the slice stays in-memory as the layering reference.)*

- Drizzle + drizzle-kit configured; `pnpm db:migrate` applies checked-in SQL migrations; migration files reviewed in PR.
- Schema v1: `users`, `sessions`, `profile_skills`, `profile_experiences`, `profile_projects`, `search_criteria`, `job_postings`, `applications`, `application_events` (per ARCHITECTURE.md ERD).
- Repository integration tests run against dockerized Postgres.

### M0-07 · Session auth · **M** · `done` *(2026-07-13: hand-rolled per ADR-0007 — 256-bit CSPRNG token (base64url) in a `cf_session` HttpOnly/SameSite=Lax/Path=/ cookie, Secure iff production, SHA-256 in `sessions.token_hash`; NO signing secret (ratified: HMAC adds nothing to a DB-verified random capability — ADR-0007 amended to Accepted, RISKS S-03 inventory now LLM key + `AUTH_BOOTSTRAP_PASSWORD`; invariant recorded: GETs never mutate, or the Lax CSRF posture breaks); argon2id via @node-rs/argon2 (no postinstall — pnpm build-script denial holds; OWASP m=19456/t=2/p=1 as named constants; ambient-const-enum workaround pinned by a `$argon2id$` unit test; CI test job green on linux-x64-gnu IS the evidence its prebuilt binary loads there); 7-day absolute TTL, rotation = insert-new+delete-old, cleanup = lazy delete on expired presentation + `deleteExpired` sweep on login (no timers); guard = root onRequest hook, opt-OUT via `config.public` (allowlist exactly GET /health + POST /auth/login, asserted by an onRoute-collector test through a buildApp seam), is404 passes through to keep the 404 contract; CSRF = Lax + Origin check on mutations incl. login (allowlist = `WEB_APP_ORIGIN` only); rate limit = hand-rolled per-IP fixed window 10/15min with injectable clock (deterministic tests, zero timers); enumeration defense = identical 401 body + boot-time dummy-hash verify on unknown email (asserted structurally, no wall-clock tests); bootstrap user from required `AUTH_BOOTSTRAP_EMAIL/PASSWORD` at first boot in main.ts only, idempotent, boot log states env password changes do NOT update it, password-never-logged asserted by capture; apps/api gained @careerforge/db and integration tests on the shared harness (packages/db exports ./test-utils + ./test-setup; vitest `groupOrder` stages db→api so cross-project TRUNCATEs can't race); example slice now guarded (authenticated coverage moved next to the auth tests). Dispositions — DISMISSED: in-memory rate limiter resets on API restart (acceptable at single-user localhost scale, ratified 2026-07-13). RATIFIED: seed's fake password hash is permanently unverifiable — the example user can never authenticate; verifyPassword returns false, never throws, on malformed hashes. PARKED: password rotation/change flow (edit env + delete user row is the manual path) — named future story if ever needed. OUT (unchanged scope): registration, password reset, /auth UI (M0-10), OpenAPI schemas (M0-09), CORS wiring (M0-10 — `WEB_APP_ORIGIN` already landed).)*

- Single user seeded from env at first boot (argon2id hash). `POST /auth/login` sets an HTTP-only `SameSite=Lax` signed cookie backed by a `sessions` row; `POST /auth/logout` revokes it; `GET /auth/me` returns the user.
- All non-auth/non-health routes 401 without a valid session; login is rate-limited; session rotates on login and expires.
- Tests cover: wrong password, expired session, rotation, rate limiting.

### M0-08 · Profile importer · **M** · `done` *(2026-07-13: first code to touch real career data — P-01 guardrails were explicit requirements. Source format grew two pieces (the schema's NOT NULL `level` and `provenance` had no markdown home; never inferred, never fabricated): NEW `skills.md` table (`| Skill | Category | Level | Years | Last used |` — resume.md's Technical Skills prose stays human-facing, unparsed) and a required `**Provenance:**` line per projects.md entry, both demonstrated in docs/profile.example/. Parser is pure (apps/api/src/modules/profile), reads resume.md's `## Professional Experience`; every deviation = ParseIssue{file, line}, all issues aggregated into one 422/CLI report, nothing silently skipped and nothing imported until clean (malformed fictional fixture pins exact file+line triples); date convention (documented, not fabrication): "March 2020" → 2020-03-01, year-only → Jan 1 / Dec 31 interval bounds, "Present" → NULL. M0-06's PARKED natural-key uniqueness came due → RESOLVED by forward-only migration 0001 (design approved pre-write 2026-07-13): UNIQUE indexes (user_id, lower(name)) on profile_skills/profile_projects (case-insensitive) and (user_id, company, title, start_date) on profile_experiences (boomerang rehire stays representable). Sync semantics (approved): full mirror in one transaction — app-level select-then-upsert on the natural keys (DB indexes are the backstop, asserted by a 23505 test), unchanged rows never rewritten, rows absent from markdown deleted; so identical re-import reports all-zero counts, THE idempotency evidence (gate run: cold example import +8/+3/+3 skills/experiences/projects with projects linked to experiences by company — latest stint wins — then re-import all zeros; seed.ts realigned to exact parser output so seed→import is also a no-op). Professional project naming a company with no resume experience = hard parse error (approved link policy). User resolution: POST /profile/import imports into the session user (guard-protected, no user id in the request); CLI resolves AUTH_BOOTSTRAP_EMAIL, or the seed user with --example. Privacy hard rules held: tests/fixtures parse docs/profile.example/ + a fictional malformed fixture ONLY; buildApp's profileDir under NODE_ENV=test defaults to a nonexistent sentinel so a test that forgets to inject fails loudly instead of reaching docs/profile/ (asserted); parse-issue values (which quote profile content) go to CLI stderr ONLY — pino gets issue counts + filenames, never values (AMENDED 2026-07-14, privacy-gate review: HTTP 422 bodies originally carried the quoting messages too; they now carry a redacted projection — file/line/field/rule — so the API never echoes profile content); privacy gate evidence: 142 distinctive real-profile tokens (emails, URLs, headings, bold spans, table cells from docs/profile/*.md) grepped against the full PR diff by a masked-output script = zero hits, and docs/profile/ confirmed gitignored with zero tracked files. Real-profile smoke: run manually by Carlos (never automated) — requires authoring docs/profile/skills.md + Provenance lines first. Dispositions — RESOLVED: M0-06 parked natural-key uniqueness (migration 0001). PARKED: job-criteria.md → search_criteria import (M1-08 formalizes the jsonb shapes; schema comment already points there). RATIFIED: skills.md is the machine-readable skills source; resume prose is display-only. RATIFIED: markdown is the single source of truth — full-sync deletes, no stale rows. OUT (unchanged scope): profile CRUD routes (GET/PUT /profile etc., M0-09+), web UI rendering (M0-10). RETRO 2026-07-14: the external second-opinion review of this story ran to completion — every item implemented, verified, or parked with a named owner; two of its concerns produced durable artifacts (scripts/privacy-check.mjs in the repo; the declared/earned/effective level-ownership park on M3-06). FINDING → RESOLVED (2026-07-14→15): shipping this retro as a direct push to master (1ad8be6) revealed branch protection still permitted direct pushes — the no-bypass guarantee was protocol, not enforcement; the push was benign (reviewed tree, green CI) but exercised the gap. Closing took two steps, because the first verification attempt FALSIFIED the fix: require-PR was added to the master-protection ruleset (2026-07-14), but the enforcement test — an attempted direct push (c563de0) — BYPASSED it via the ruleset's inherited M0-05 bypass actor (RepositoryRole admin, mode always), which covers every rule in the ruleset; that push also shipped a disposition claiming "verified by rejection" before any rejection existed (corrected here). Bypass actor removed 2026-07-15 — bypass list now EMPTY, deliberately not a PR-only bypass mode (that would still allow merging red checks); the emergency hatch is editing the ruleset itself, deliberate friction and audit-logged. Second direct-push attempt REJECTED (GH013 "push declined due to repository rule violations — Changes must be made through a pull request", exit 1); this correction reached master via the first PR to land under full enforcement. LESSON (general): outcome-describing text is authored AFTER the outcome exists, never from the expected result — the false claim shipped with a green gate because the gate cannot check claims about tests that have not run; evidence-before-claims extends to verification narratives.)*

- `POST /profile/import` (and a CLI script) parses `docs/profile/` markdown into profile tables; running against `docs/profile.example/` seeds the demo profile; import is idempotent (re-import updates, doesn't duplicate).
- Skills carry `level` (expert/solid/rusty/learning), `years`, `last_used`; projects carry `provenance` (professional / personal / personal_ai_assisted).
- Parse failures report file + line, never silently skip. Tests use the example profile only.

### M0-08b · Bootstrap password sync + direct-node CLI smoke guard · **S** · `done` *(2026-07-14: M0-07's PARKED password-rotation story came due (real AUTH_BOOTSTRAP_PASSWORD rotated; old value had `$` chars that shell/Compose interpolation mangled) → RESOLVED by `pnpm auth:sync-bootstrap`: reads AUTH_BOOTSTRAP_EMAIL/PASSWORD from the zod-validated env (parseEnv — its min-12 also catches interpolation-mangled values; CLI #4 is the first CLI to use parseEnv rather than ad-hoc checks), verifies the stored hash first (match = stated no-op, nothing written, sessions survive — idempotency evidence), otherwise re-hashes with the pinned argon2id constants and calls the new `UsersRepository.rotatePasswordHash` — UPDATE users.password_hash + DELETE all the user's sessions in ONE transaction (a rotated credential must invalidate live capabilities; single repo method spanning two tables per the syncProfile precedent). RETIRED: M0-07's "edit env + delete user row" manual path — post-M0-08 every profile table cascades from users (migration 0000 §FKs), so deleting the row would destroy the imported profile; the boot log and .env.example now point at auth:sync-bootstrap instead. Secrecy invariants: password read from env only (never argv), never printed on any path — sync-bootstrap.test.ts asserts no-password-values on all three result paths (rotated / already-synced / user-missing) with fixture creds; CLI output = status + counts + user id only; parseEnv errors name variables, never values. Direct-node smoke guard CREATED (M0-08 close-out follow-through, design ratified 2026-07-14): cli-smoke.test.ts runs all 4 CLIs (db:migrate, db:seed, profile:import, auth:sync-bootstrap) under `node <cli>.ts` with an empty env, asserting exit 1 + the missing-variable message + no SyntaxError + empty stdout; valid because every CLI statically imports its full module graph at top level, so ES-module linking trips strip-only parse errors before the env check exits — verified per CLI: migrate.ts/seed.ts/import-profile.ts/sync-bootstrap-password.ts all static, zero dynamic imports in packages/db, apps/api, packages/core non-test source; no force-loading needed. Node floor for `--env-file-if-exists` (≥22.9) satisfied: .nvmrc=24, engines >=24, CI reads .nvmrc — same wiring as the existing 3 CLIs. No schema change, no migration, no new ADR (operational extension of ADR-0007). Manual verification by Carlos: new password 200, old password 401, pre-rotation cookie 401. Dispositions — PARKED: a dynamic import() introduced anywhere in a CLI module graph would silently shrink the smoke guard's coverage (module linking would no longer load that subtree before the env check, and the guard stays green); candidate fix is a lint rule banning dynamic imports in CLI graphs — decision deferred. PARKED (schema review, 2026-07-14): (1) `profile_projects.provenance` conflates two dimensions — origin (professional/personal) and AI-assistance — in one CHECK-constrained column; split before any consumer needs to filter on one dimension independently. (2) Hard-erroring a professional project whose company has no resume.md experience assumes resume.md is complete and company names never diverge (renames, acquisitions); re-examine when profile CRUD (M0-09+) allows direct edits. (3) Whitespace normalization is APP-SIDE ONLY — a " TypeScript" probe proved the lower(name) unique indexes accept whitespace variants the parser would trim; every future writer MUST route through the parser's shared normalization, and whether to also enforce in-DB (trigger vs generated column) is an open question. (4) Dump/backup gitignore reasoning lives in .gitignore itself: no dump naming variant may ever be commit-eligible; /*.sql is root-scoped so committed migrations stay unaffected. RECORDED (privacy surface, approved design): local Claude session transcripts and scratchpads contain MASKED real-profile tokens — first 2 characters + length, emitted by scripts/privacy-check.mjs — so transcript/scratchpad hygiene is a known surface; these files are local-only and must never be published.)*

- `pnpm auth:sync-bootstrap` applies a changed env password to the existing bootstrap user: re-hash in place + revoke all sessions, one transaction; running it again is a stated no-op.
- The password value is never accepted as an argument, never logged, never printed on any path; errors name variables only.
- All four CLIs are covered by an automated direct-node smoke guard (empty env → clean variable-naming failure).

### M0-09 · OpenAPI docs · **S** · `done` *(2026-07-14: fastify-type-provider-zod v7 wired into buildApp (validator + serializer compilers) and every route — health/auth/example/profile — now declares zod params/body/response schemas; ADR-0002 flipped Proposed → Accepted (this was its stated promise). The hand-rolled login safeParse + InvalidLoginBodyError DELETED: body validation runs pre-handler, and the never-echo property became ARCHITECTURAL — the error handler's VALIDATION_ERROR branch builds messages from validationContext + instancePath + zod issue CODE only, never issue.message (enum/literal messages quote received values; an M1 posting-status enum would have silently started echoing) — pinned by an enum-mismatch probe asserting the submitted value is absent, plus the login-specific test. Spec decision (delegated, disclosed): COMMITTED at docs/api/openapi.json (OpenAPI 3.1.0, 7 paths) + drift-as-a-test — a committed spec makes every API-surface change diff-visible in review, and openapi-drift.test.ts regenerates in-memory and byte-compares inside `pnpm test`, so drift fails the local gate AND CI's required `test` check with zero workflow/ruleset changes. Generation: `pnpm openapi:generate` → generate-openapi.ts (5th CLI) renders via the shared openapi.ts path from a fixed inert SPEC_ENV — the spec is env-independent by construction, so the CLI reads no process.env at all (deterministic, CI-safe; pg.Pool lazy, nothing connects). /docs UI: @fastify/swagger-ui at routePrefix /docs registered iff NODE_ENV !== 'production' (apps/api/src/routes/docs.ts); its auth exemption is a scoped onRoute hook marking config.public (swagger-ui has no per-route config passthrough) — the same deliberate opt-out as /health; @fastify/swagger itself registers in every env (route-less in-memory builder only). Guard-the-guard: allowlist test now pins the exact dev public set (health, login, + 6 swagger-ui routes) AND the production set (exactly GET /health + POST /auth/login — no /docs, no exemption). cli-smoke guard gained a second assertion mode: env-free CLIs assert exit 0 + expected stdout shape (openapi:generate has the largest module graph of any CLI — the strongest strip-only tripwire), env-required CLIs keep the exit-1 variable-naming assertion. FINDINGS (both implementer-found) → RESOLVED: (1) a green test proven blind by probe, then fixed — the AppDeps.onRoute collector snapshotted config.public BEFORE scoped onRoute hooks ran, so the allowlist test kept passing its two-route pin while /docs actually served unauthenticated; a probe printed the collected flags against live behavior to prove the blindness before the fix, and the seam now exposes `public` as a live getter over the final route config, read after ready(). (2) second-order review of the accepted smoke-guard amendment: smoking generate-openapi as specified would have regenerated the committed spec on disk before the drift test read it, permanently masking exactly the drift it exists to catch → --out <path> flag; the smoke writes to a tempdir. Sizing honesty: sized S, executed as M — the kickoff premise "type provider is already the route pattern" was falsified at plan time (auth.routes.ts said the wiring "lands with M0-09"); plan mode caught the false premise before execution, ask-first working upstream. Rode along: the ledger law (outcome-describing text is authored AFTER the outcome exists) codified in CLAUDE.md hard rules. Gate evidence 2026-07-14: typecheck + lint + test all green (117/117, incl. drift test against the committed spec); manual dev server: GET /docs 200 (HTML UI), /docs/json = the 3.1.0 spec, unauthenticated /example/items still 401; NODE_ENV=production boot: /docs and /docs/json 404, /health 200. Spec truthfulness notes: the committed spec is generated from a dev-mode build but IS the production API surface by construction — swagger-ui marks its routes `schema: { hide: true }` and @fastify/swagger excludes hidden routes, and /docs is the only env-dependent surface (documented in openapi.ts + ARCHITECTURE §5). The 403 responses on POST /auth/login, /auth/logout, /profile/import were not in the plan — the spec documented reality the plan omitted: the root guard's CSRF origin check (auth.hooks.ts, ForbiddenOriginError) runs on mutating methods only, which is also why GETs carry no 403 (Lax posture + GETs-never-mutate invariant, ADR-0007). Dispositions — RATIFIED: 422 responses enumerate PARSE_RULES (now a runtime const) in the spec; the serializer enforces the redacted-issue projection on the wire (defense-in-depth: undeclared fields are stripped). RATIFIED: the safe-integer minimum/maximum bounds zod v4 emits on int fields are accepted serialization noise — never hand-suppress; removal would trip drift for zero gain. PARKED: OpenAPI tags/operation summaries and shared $ref components — polish, revisit when the surface grows past one screen (M1). OUT (unchanged scope): profile CRUD routes (M0-10+), typed web client generation from the spec (M0-10 uses packages/core types).)*

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
- PARKED design constraints from the M0-08 importer review (2026-07-14), to resolve before this story starts: (1) **field ownership** — the importer owns `profile_skills.level` today and its full-sync mirror overwrites/deletes freely; a declared_level / earned_level / effective_level split is a CANDIDATE only, not a decision. (2) **Full-sync must never destroy or orphan mastery evidence** — an upgrade earned here has no markdown home, so a re-import would silently revert it (and cascade-deleting a skill row would orphan its evidence) unless ownership is resolved first. (3) This story introduces the first **second writer** to profile tables — it must route through the parser's shared normalization (see the M0-08b schema park). (4) **Downgrade/correction semantics** are unspecified: evidence goes stale and upgrades can be wrong; the audit trail needs a story for reversals, not just grants.

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

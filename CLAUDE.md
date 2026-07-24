# CareerForge — Project Rules

## What this is
A career-development platform: Job Intelligence Engine + Portfolio + Skill Accelerator.
Modular monolith. TypeScript everywhere. Vue/Nuxt frontend, Fastify backend, PostgreSQL + Drizzle.
**This repo is PUBLIC.** Real career data is private and local-only.

## Read first
- docs/PLAN.md — vision, MVP definitions, 12-week roadmap
- docs/ARCHITECTURE.md — module boundaries, data model (ERD), API surface
- docs/DECISIONS/ — ADRs 0001–0007 (read the relevant one before touching its area)
- docs/BACKLOG.md — current stories + acceptance criteria
- docs/RISKS.md — security/privacy/legal invariants

## Hard rules (non-negotiable)
- NEVER commit secrets. Use .env locally; .env.example documents every variable.
- An exposed credential — any value that leaves .env for an unintended surface (editor-selection context attachment, terminal echo, transcript, paste) — is rotated by default; dismissal requires proving the value was never live. Companion habit: .env stays closed and unselected in the editor while agent sessions run.
- **Privacy boundary (public repo):** never commit `docs/profile/`, real names/contact info beyond what's deliberately published, salary data, real postings, or application history. Tests, fixtures, demos, and screenshots use `docs/profile.example/` (fictional) only.
- No scraping code of any kind unless a milestone explicitly authorizes it. MVP ingests pasted job text only. If collection is ever authorized: respect ToS/robots.txt/rate limits/auth boundaries; never bypass CAPTCHAs or anti-bot protections (RISKS L-01).
- Never fabricate resume content, metrics, or experience. Fit analysis must cite evidence; LLM-quoted evidence must verbatim-match its source or be flagged (ADR-0006).
- All job-posting text is UNTRUSTED input: escape before display (never render as HTML/markdown), never interpolate into LLM system prompts, always pass as delimited data with a per-request random boundary token.
- Everything LLM-generated is draft-until-reviewed. The system never sends anything resembling an application.
- Any task touching auth, DB schema, migrations, or LLM prompts: enter plan mode first.
- Evidence before claims: run the commands and show output before saying tests pass or a feature works.
- Outcome-describing text is authored AFTER the outcome exists, never from the expected result — evidence-before-claims extends to verification narratives (dispositions, retros, commit messages).
- Any modification to a verification gate (privacy-check, cli-smoke, drift test, allowlist test, CI checks) must include a demonstrated detection — a proven FAIL on planted fictional data — in the same change. The M0-09 privacy-gate narrowing was saved by exactly this; it is required, not fortunate.

## Module boundaries (enforced)
- `packages/scoring` is pure and deterministic; it never imports `packages/llm`.
- `packages/llm` is the only module that touches LLM provider SDKs; prompts live in its versioned registry (new prompt behavior = new version, never edit-in-place).
- Only `packages/db` contains SQL/Drizzle. Routes → services → repositories; no SQL in routes or services.
- `apps/portfolio` never imports platform packages or private data.
- Nuxt server routes carry no platform business logic; `apps/api` is the only backend.

## Workflow
- Plan mode for anything non-trivial (multi-file, architectural, unfamiliar).
- Small, reviewable diffs. One logical change per commit, conventional commit messages.
- Every change reaches main via branch + PR with green checks — including one-line docs. Enforced by branch protection, not convention: require-PR (2026-07-14) with an EMPTY bypass list (2026-07-15) — direct pushes are rejected for everyone; the only emergency hatch is editing the ruleset itself (deliberate friction, audit-logged).
- After pushing to a PR branch: verify `gh pr view --json headRefOid` equals the pushed SHA before trusting checks (prefer the SHA-scoped check-runs API), AND pass that SHA to the merge itself — `gh pr merge --match-head-commit <sha>` — so a stale-head merge fails with a 409 instead of succeeding. Check-then-act becomes compare-and-swap; "checks green" is a claim about a commit, not a PR (the PR #11 merge race).
- External-review gate, split by content class (ratified 2026-07-17): (a) any change containing executable or gate-touching content — workflows, scripts, CI config, hooks, lint/ruleset config, test files, anything that runs or governs what runs — requires the external one-glance review BEFORE the merge word, including one-liners; (b) pure-append prose ledger/docs changes (no executable content, historical text untouched) may merge post-checks with retroactive review.
- Merging a PR requires an explicit merge word from Carlos, per PR. Sole exception: a docs-only recovery PR whose entire content was already dictated/approved in the same review cycle, with intent disclosed before merging (first and defining use: PR #12).
- New major technical choice = new ADR in docs/DECISIONS/ (numbered, with product/skill/employability value stated).
- Definition of done: code + tests + migration (if schema) + docs updated + BACKLOG.md story status updated, in the same change.
- Before finishing any task: pnpm typecheck && pnpm lint && pnpm test — all must pass.
- Gate commands run bare — never piped or filtered in ways that consume the exit code (`pnpm lint | tail` reports tail's exit 0 — the M0-10 red-lint push); if filtering is unavoidable, `set -o pipefail` first.
- Per-artifact NUL/C0-byte scan before gates, on the COMMITTED blob: `git show <sha>:<path> | perl -ne 'exit 1 if /\x00/'` — a **pipe** preserves the NUL; command substitution (`$(git show …)`) strips it, so the scan must pipe, never capture. Source-byte law: files carry printable ASCII only; a needed non-ASCII codepoint (incl. U+0000 in a guard literal) is a visible `\uXXXX` escape, never a raw byte. This scan has caught real literal-NUL defects repeatedly (the running strike counter lives in the BACKLOG ledger); M2-12 added one more — a copy artifact put a raw NUL into a v2 prompt guard, flagged before gates.
- Every environment finding, deviation, or observation surfaced during a session must end in one of three states: (a) written into the appropriate doc, (b) parked with a named future story, or (c) explicitly dismissed with a reason — never left only in chat output. Session summaries list the disposition of each.
- Manual smoke tests authenticate with throwaway credentials created for the smoke and removed after — never the real bootstrap pair. Smoke artifacts (cookie jars, captured logs) stay in the session scratchpad and are deleted when the smoke ends.
- On any branch that touched profile-adjacent code: run `node scripts/privacy-check.mjs` AFTER the final commit, BEFORE pushing (the P-01 content leg — see Commands). It reads the committed branch diff only; uncommitted changes are invisible to it. CI's privacy legs are structural only (gitleaks + tracked-file guard); the content comparison can only happen locally where the real profile exists.

## Conventions
- pnpm workspaces monorepo. apps/ for deployables, packages/ for shared code. No build orchestrator (ADR-0004 has the criteria for adding one).
- Zod for validation at every boundary (API input, LLM output, env vars). Fastify routes declare zod schemas; OpenAPI is generated from them.
- Structured JSON logging (pino) with request IDs. No console.log in committed code. No PII or full posting text in logs.
- Vitest for unit/integration (integration against dockerized Postgres). Playwright for e2e where justified. LLM tests use the mocked provider + recorded fixtures; the injection corpus (M1-07) must stay green.
- Migrations: drizzle-kit generated SQL, checked in, forward-only.
- Deterministic logic and LLM-generated analysis live in separate, clearly named modules.

## Commands
- pnpm dev / pnpm test / pnpm typecheck / pnpm lint
- pnpm test:e2e (Playwright, chromium; ports 4310/4311; scratch careerforge_e2e DB created at API boot, dropped at teardown; CI-only retries — see apps/web/README.md)
- pnpm db:migrate / pnpm db:seed / pnpm db:generate (drizzle-kit → SQL migration from schema changes)
- pnpm profile:import (real docs/profile/ → bootstrap user; manual only, never run by tests) / pnpm profile:import --example (fictional example profile → seed user)
- pnpm auth:sync-bootstrap (apply a rotated AUTH_BOOTSTRAP_PASSWORD to the existing bootstrap user: re-hash in place + revoke all sessions in one transaction; idempotent; value read from validated env only, never a CLI arg, never printed)
- pnpm extraction:verify-quotes (M1-06 backfill: verify every quote_verified-NULL requirement against its posting text, set verdicts, recompute run statuses — flagged iff any quote fails; idempotent, per-run transactions; output is counts/ids/statuses only, never quote or posting text)
- docker compose up -d (postgres) — integration tests need it running (they use the derived careerforge_test DB and fail fast when it's down)
- node scripts/privacy-check.mjs — manual privacy gate (P-01 content leg): derives tokens from the real docs/profile/ at runtime (incl. phone/salary probes matched in normalized form) and greps them against the lines the COMMITTED branch diff ADDS (`git diff <origin-default-branch>...HEAD`, added lines only — deleted/context lines are already-public base content; main fallback; pnpm-lock.yaml lines excluded since M0-10 — registry-derived public identifiers kept colliding with short real-skill cells, and private data cannot enter a lockfile through dependency resolution; since M1-01, tokens already occurring in the base branch's committed content are subtracted as public vocabulary — distinctiveness-based matching per the resolved M1-01 park, closing the common-English-word false-positive class); prints masked tokens + counts only, never values. Run after committing, before pushing — uncommitted changes are invisible to it. Exit 0 = clean, 1 = leak found, 2 = cannot run (no docs/profile/ — CI/fresh clones; never reported as a pass).

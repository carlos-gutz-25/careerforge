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
- **Privacy boundary (public repo):** never commit `docs/profile/`, real names/contact info beyond what's deliberately published, salary data, real postings, or application history. Tests, fixtures, demos, and screenshots use `docs/profile.example/` (fictional) only.
- No scraping code of any kind unless a milestone explicitly authorizes it. MVP ingests pasted job text only. If collection is ever authorized: respect ToS/robots.txt/rate limits/auth boundaries; never bypass CAPTCHAs or anti-bot protections (RISKS L-01).
- Never fabricate resume content, metrics, or experience. Fit analysis must cite evidence; LLM-quoted evidence must verbatim-match its source or be flagged (ADR-0006).
- All job-posting text is UNTRUSTED input: escape before display (never render as HTML/markdown), never interpolate into LLM system prompts, always pass as delimited data with a per-request random boundary token.
- Everything LLM-generated is draft-until-reviewed. The system never sends anything resembling an application.
- Any task touching auth, DB schema, migrations, or LLM prompts: enter plan mode first.
- Evidence before claims: run the commands and show output before saying tests pass or a feature works.

## Module boundaries (enforced)
- `packages/scoring` is pure and deterministic; it never imports `packages/llm`.
- `packages/llm` is the only module that touches LLM provider SDKs; prompts live in its versioned registry (new prompt behavior = new version, never edit-in-place).
- Only `packages/db` contains SQL/Drizzle. Routes → services → repositories; no SQL in routes or services.
- `apps/portfolio` never imports platform packages or private data.
- Nuxt server routes carry no platform business logic; `apps/api` is the only backend.

## Workflow
- Plan mode for anything non-trivial (multi-file, architectural, unfamiliar).
- Small, reviewable diffs. One logical change per commit, conventional commit messages.
- New major technical choice = new ADR in docs/DECISIONS/ (numbered, with product/skill/employability value stated).
- Definition of done: code + tests + migration (if schema) + docs updated + BACKLOG.md story status updated, in the same change.
- Before finishing any task: pnpm typecheck && pnpm lint && pnpm test — all must pass.
- Every environment finding, deviation, or observation surfaced during a session must end in one of three states: (a) written into the appropriate doc, (b) parked with a named future story, or (c) explicitly dismissed with a reason — never left only in chat output. Session summaries list the disposition of each.

## Conventions
- pnpm workspaces monorepo. apps/ for deployables, packages/ for shared code. No build orchestrator (ADR-0004 has the criteria for adding one).
- Zod for validation at every boundary (API input, LLM output, env vars). Fastify routes declare zod schemas; OpenAPI is generated from them.
- Structured JSON logging (pino) with request IDs. No console.log in committed code. No PII or full posting text in logs.
- Vitest for unit/integration (integration against dockerized Postgres). Playwright for e2e where justified. LLM tests use the mocked provider + recorded fixtures; the injection corpus (M1-07) must stay green.
- Migrations: drizzle-kit generated SQL, checked in, forward-only.
- Deterministic logic and LLM-generated analysis live in separate, clearly named modules.

## Commands
- pnpm dev / pnpm test / pnpm typecheck / pnpm lint
- pnpm db:migrate / pnpm db:seed
- docker compose up -d (postgres)

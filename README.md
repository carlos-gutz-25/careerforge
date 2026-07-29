# CareerForge

[![ci](https://github.com/carlos-gutz-25/careerforge/actions/workflows/ci.yml/badge.svg)](https://github.com/carlos-gutz-25/careerforge/actions/workflows/ci.yml)
[![security](https://github.com/carlos-gutz-25/careerforge/actions/workflows/security.yml/badge.svg)](https://github.com/carlos-gutz-25/careerforge/actions/workflows/security.yml)

A personal career-development platform, built in public: **Job Intelligence Engine** (paste a job posting → evidence-cited fit analysis across seven explainable sub-scores → honest gap classification → improvement plans and application tracking) + **Professional Portfolio** (statically generated, accessibility- and performance-budgeted case studies) + **Engineering Skill Accelerator** (real gaps from real postings → learning plans with evidence-backed mastery tracking).

**Status:** v1 complete — the 12-week roadmap shipped (M0–M4, 2026-07-26). v2 is in progress: M5–M8 are delivered and M9 is built with its operator dogfood underway (Resume Studio with provenance-gated composition and ATS auditing, typed coaching recommendations, application gameplans, the full design overhaul of both frontends, the remaining platform UI surfaces, and Skill Signal); next up are the M10 Azure fictional-data demo and M11 proof & launch — see [PLAN §7](docs/PLAN.md#7-v2-roadmap-post-12-week-planned-2026-07-26). The platform (Job Intelligence Engine + Skill Accelerator) runs locally by decision ([ADR-0015](docs/DECISIONS/0015-platform-deployment.md) — it holds real private career data); the portfolio is live at [carlosgutz.com](https://carlosgutz.com). Start with the docs.

## The rule this repo is built on: honesty is a feature

Fit scores are deterministic and explainable; every claim cites verbatim evidence from both the job posting and the profile; the LLM extracts but never scores; nothing is ever fabricated, inflated, or auto-sent. See [docs/DECISIONS/0005](docs/DECISIONS/0005-llm-integration-pattern.md) and [0006](docs/DECISIONS/0006-prompt-injection-defense.md).

## Public repo, private data

This repository is public, but **real career data never enters it**:

- `docs/profile/` holds the real profile (resume, projects, job criteria) — **gitignored**, local only, backed by pre-commit and CI guards.
- [`docs/profile.example/`](docs/profile.example/) is a fully fictional profile with the same structure; all tests, fixtures, demos, and screenshots use it exclusively.
- Secrets live in `.env` (gitignored); `.env.example` documents variable names only.
- [gitleaks](https://github.com/gitleaks/gitleaks) runs as a pre-commit hook and in CI.

One-time setup after cloning:

```sh
brew install gitleaks
git config core.hooksPath .githooks
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | Product vision, MVP definitions, 12-week roadmap |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, monorepo layout, data model (ERD), API surface |
| [docs/DECISIONS/](docs/DECISIONS/) | ADRs — every major choice, with its product/skill/employability rationale |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Prioritized stories with acceptance criteria, per milestone |
| [docs/RISKS.md](docs/RISKS.md) | Security, privacy, legal, and scope risks with enforced mitigations |
| [docs/RUNBOOKS.md](docs/RUNBOOKS.md) | Operational procedures — each with an owner and a trigger (e.g. Anthropic key rotation) |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decision log for open/resolved product questions |

## Stack (per ADRs)

TypeScript everywhere · Nuxt 4 (Vue 3) frontends · Fastify API · PostgreSQL 16 + Drizzle · pnpm workspaces · Vitest · Docker for local dev · GitHub Actions CI · Anthropic API behind a swappable provider interface.

## Repository layout

pnpm workspaces, no build orchestrator — root scripts run everything via `pnpm -r` ([ADR-0004](docs/DECISIONS/0004-pnpm-workspaces-monorepo.md) has the criteria for ever adding one).

```text
apps/
├── api/        Fastify backend (routes → services → repositories)
├── web/        Nuxt platform UI — talks only to apps/api
└── portfolio/  Nuxt SSG portfolio — never imports platform packages
packages/
├── config/     Shared tsconfig, eslint, and vitest config consumed by every workspace
├── core/       Domain types, zod schemas, shared constants — zero internal deps
├── db/         Drizzle schema, migrations, repositories — the only module with SQL
├── llm/        LLM provider interface, versioned prompts — the only module with LLM SDKs
└── scoring/    Deterministic fit-scoring engine — pure functions, never imports llm
```

`apps/api` is the platform backend on a Fastify foundation: `/health`, pino request-id logging, a centralized `{ error: { code, message } }` handler (the canonical error-body contract: stacks never appear in any response body; dev 500s may carry `error.message`, production 500s are fully generic, and intentional 4xx messages pass through in both modes), and the routes → services → repositories layering (the M0 in-memory reference slice is retained as the layering reference; real Drizzle repositories live in `packages/db` since M0-06). The API now spans the full platform surface — postings, extraction, fit scoring, gaps, plans, exercises, mastery, interview-prep, criteria tuning, resume composition and export, application gameplans, market signal, and demo blueprints (58 OpenAPI paths). `apps/web` is the platform UI over that API and `apps/portfolio` is the live SSG portfolio. Module boundaries ([ARCHITECTURE §2](docs/ARCHITECTURE.md#2-monorepo-layout)) are enforced twice: structurally (pnpm's strict isolation — a workspace can only import what its `package.json` declares, so `scoring` cannot resolve `llm` at all) and by lint (`no-restricted-imports` blocks per directory in the shared eslint config). dependency-cruiser was evaluated at M0-05 and **deferred**: both existing layers independently reject violations (proven by M0-02's negative test), so a third checker would add config and CI time without new enforcement. Adoption criteria (in the spirit of [ADR-0004](docs/DECISIONS/0004-pnpm-workspaces-monorepo.md)): adopt it the first time a boundary violation slips past both existing layers, or when the rules outgrow `no-restricted-imports` — e.g. graph-level constraints (cycle detection, an allowed-dependency matrix) that per-directory import blocks cannot express.

Two deliberate tooling deviations: import-x's resolution-dependent lint rules (`no-unresolved`, `namespace`, …) are off — tsc already owns module resolution with full workspace/`exports` awareness, and a second resolver would only duplicate it, less accurately. And `@careerforge/config` is exempt from the "no internal packages" walls: it is build tooling consumed by every workspace, not a platform package.

## Development

### Fresh install, in order

Local Postgres requires a container runtime — Docker Desktop, OrbStack, and colima all work; the compose file doesn't care which. Note that VM-based runtimes such as colima must be started first (`colima start`), or every `docker` command fails with a daemon-connection error.

```sh
pnpm install           # Node ≥ 24, pnpm ≥ 11 (corepack enable gets the pinned pnpm)
cp .env.example .env   # then fill in values; every variable is documented there
docker compose up -d   # Postgres 16 on a persistent named volume (pgdata)
pnpm db:migrate        # REQUIRED before first boot — the API validates env, creates the
                       # bootstrap user, and listens; it never runs migrations itself
pnpm dev               # terminal 1: boots apps/api on :4301 (env is zod-validated first —
                       # fails fast if .env is wrong); first boot creates the bootstrap user
pnpm dev:web           # terminal 2: boots apps/web on :4300 — log in with the bootstrap
                       # email/password from .env
```

To use your own data instead of the fictional example: author the gitignored `docs/profile/` (format below), then `pnpm profile:import` — the API must have booted at least once first so the bootstrap user exists. The `4300`/`4301` ports must stay aligned with `WEB_APP_ORIGIN`/`NUXT_PUBLIC_API_BASE` in `.env`; the dev servers refuse to silently switch ports because that would break the CORS/CSRF-origin contract.

### Everyday commands

```sh
pnpm dev            # API (terminal 1)
pnpm dev:web        # platform web app (terminal 2)
pnpm dev:portfolio  # public portfolio, when working on it
pnpm typecheck      # tsc --noEmit in every workspace
pnpm lint           # eslint + prettier --check across the repo
pnpm test           # one vitest run covering every workspace's suite
pnpm format         # prettier --write
```

The env schema (`apps/api/src/env.ts`) is the single source of truth: boot fails fast naming any missing/invalid variable, and a test asserts every schema key is documented in `.env.example`.

Auth (M0-07, ADR-0007): the single user is created at first boot from `AUTH_BOOTSTRAP_EMAIL` / `AUTH_BOOTSTRAP_PASSWORD` — set both in `.env` before `pnpm dev`. Changing the password in `.env` later does **not** update the existing user (the boot log says so too); run `pnpm auth:sync-bootstrap` to apply a rotated `AUTH_BOOTSTRAP_PASSWORD` to the existing user — it re-hashes in place and revokes all sessions in one transaction. All API routes except `GET /health` and `POST /auth/login` require the session cookie.

Profile import (M0-08): author the gitignored `docs/profile/` in the format `docs/profile.example/` demonstrates — `resume.md` with a `## Professional Experience` section, `skills.md` with the skills table (the machine-readable home of level/years/last-used; the resume's Technical Skills prose is not parsed), and `projects.md` where every entry carries an explicit `**Provenance:**` line — then `pnpm profile:import` mirrors it into the profile tables for the bootstrap user (`POST /profile/import` does the same for the session user). Import is an idempotent full sync: re-import updates in place, rows removed from the markdown are deleted, and any parse problem is reported as `file:line` with nothing imported until all are fixed. `pnpm profile:import --example` imports the fictional example profile into the seeded demo user. Tests only ever parse `docs/profile.example/` (RISKS P-01).

Internal packages are consumed as TypeScript source (`exports` → `./src/index.ts`) — no build step, by design. The same convention extends to execution: Node runs TypeScript directly via native type stripping (no tsx/ts-node, no compile step). Two consequences, both deliberate: imports of local TS files use explicit `.ts` extensions (enabled by `allowImportingTsExtensions`, safe under `noEmit`), and directly-executed code must stay type-stripping-compatible — no enums, namespaces, or parameter properties.

## A note on ingestion

The MVP ingests **manually pasted** job-posting text only. There is no scraping or automated collection in this codebase, by design; any future collection work is gated by the legal invariants in [docs/RISKS.md](docs/RISKS.md) (L-01).

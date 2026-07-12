# CareerForge — Architecture

**Status:** Draft for review · **Last updated:** 2026-07-12

Companion to [PLAN.md](./PLAN.md). Decisions referenced here are justified in [DECISIONS/](./DECISIONS/).

---

## 1. System Overview

CareerForge is a **modular monolith**: one deployable API, one platform UI, one statically generated portfolio site, and shared packages with enforced boundaries. No microservices — a single senior engineer, a single user, and a local-first deployment make distributed complexity indefensible (see ADR-0004 for the tooling corollary; the monolith itself is a hard project constraint).

```mermaid
flowchart LR
    subgraph Local["Carlos's machine (Docker)"]
        WEB["apps/web<br/>Nuxt platform UI"]
        API["apps/api<br/>Fastify"]
        PG[("PostgreSQL 16")]
        WEB -->|"REST + session cookie"| API
        API --> PG
    end

    subgraph Cloud["Public"]
        PORT["apps/portfolio<br/>Nuxt SSG on static host"]
        LLMAPI["LLM provider<br/>(Anthropic default, swappable)"]
    end

    API -->|"packages/llm<br/>(untrusted text as delimited data)"| LLMAPI
    CI["GitHub Actions CI"] -->|"build + budgets"| PORT
    CARLOS((Carlos)) --> WEB
    PUBLIC((Recruiters / public)) --> PORT
```

Trust boundaries:

- **Job-posting text is untrusted input** everywhere: sanitized before display, never interpolated into system prompts, always passed to the LLM as delimited data (ADR-0006).
- **LLM output is untrusted** until zod-validated and its evidence quotes are verbatim-verified against the source.
- **The public repo is a trust boundary**: real career data lives only in gitignored `docs/profile/` and the local database (ADR-0007).

## 2. Monorepo Layout

pnpm workspaces (ADR-0004):

```
careerforge/
├── apps/
│   ├── api/            # Fastify. routes → services → repositories. No SQL in routes.
│   ├── web/            # Nuxt platform UI (job engine + accelerator). Talks only to apps/api.
│   └── portfolio/      # Nuxt SSG portfolio. No runtime backend. Deployed from CI.
├── packages/
│   ├── core/           # Domain types, zod schemas, shared constants. Depends on nothing internal.
│   ├── db/             # Drizzle schema, migrations, repository implementations.
│   ├── llm/            # LlmProvider interface, Anthropic adapter, versioned prompts, injection guards.
│   ├── scoring/        # Deterministic fit-scoring + gap-classification engine. Pure functions.
│   └── config/         # Shared tsconfig, eslint config.
├── docs/
│   ├── profile/        # REAL career data — gitignored, local only
│   ├── profile.example/# Sanitized fictional profile — committed, used by tests/demos
│   ├── DECISIONS/      # ADRs
│   └── *.md            # PLAN, ARCHITECTURE, BACKLOG, RISKS, OPEN-QUESTIONS
├── docker-compose.yml  # Postgres 16
└── .github/workflows/  # CI: typecheck, lint, test, portfolio build + budgets
```

### Module boundary rules (enforced by review + lint rules where practical)

| Rule | Why |
| --- | --- |
| `packages/scoring` never imports `packages/llm` | Deterministic logic and model output must stay separable and independently testable (hard constraint) |
| `packages/llm` is the only module that talks to LLM providers | Single choke point for injection defense, prompt versioning, cost tracking, provider swap |
| Only `packages/db` contains SQL/Drizzle queries | Repository layering; routes and services stay storage-agnostic |
| `packages/core` has zero internal dependencies | It defines the shared language (types + zod schemas) everything else validates against |
| `apps/portfolio` never imports platform packages | The portfolio must build and deploy with zero access to private data or the API |
| Posting-derived text never enters a system prompt, anywhere | Prompt-injection defense (ADR-0006) |

## 3. Core Data Model

All tables carry `user_id` (single user today; multi-user is a migration, not a redesign — ADR-0007). Timestamps (`created_at`, `updated_at`) omitted below for brevity.

```mermaid
erDiagram
    users ||--o{ profile_skills : has
    users ||--o{ profile_experiences : has
    users ||--o{ profile_projects : has
    users ||--|| search_criteria : has
    users ||--o{ job_postings : ingests

    profile_experiences ||--o{ profile_projects : includes

    job_postings ||--o{ extraction_runs : "analyzed by"
    extraction_runs ||--o{ requirements : produces
    job_postings ||--o{ fit_reports : "scored in"
    fit_reports ||--o{ fit_sub_scores : "composed of"
    requirements ||--o{ evidence_links : "supported by"
    requirements ||--o| gaps : "may become"
    fit_reports ||--o{ gaps : summarizes
    job_postings ||--o| applications : "tracked as"
    applications ||--o{ application_events : logs
    fit_reports ||--o| improvement_plans : "drafted from"
    improvement_plans ||--o{ plan_items : contains

    gaps }o--o{ learning_plans : "addressed by"
    learning_plans ||--o{ exercises : contains
    exercises ||--o{ mastery_evidence : "proven by"
    exercises ||--o| case_studies : "may become"
    profile_projects ||--o| case_studies : "may become"

    users {
        uuid id PK
        text email
        text password_hash
    }
    profile_skills {
        uuid id PK
        uuid user_id FK
        text name
        text category
        text level "expert | solid | rusty | learning"
        int years
        date last_used
    }
    profile_experiences {
        uuid id PK
        uuid user_id FK
        text company
        text title
        date start_date
        date end_date
    }
    profile_projects {
        uuid id PK
        uuid user_id FK
        uuid experience_id FK "nullable — personal projects"
        text name
        text provenance "professional | personal | personal_ai_assisted"
        text summary
    }
    search_criteria {
        uuid id PK
        uuid user_id FK
        jsonb hard_filters "from job-criteria.md exclude_when"
        jsonb positive_signals
        jsonb negative_signals
        jsonb comp_bounds
    }
    job_postings {
        uuid id PK
        uuid user_id FK
        text raw_text "UNTRUSTED"
        text content_hash "dedupe"
        text company
        text title
        text source_note "where Carlos found it"
        text status "new | extracted | scored | archived"
    }
    extraction_runs {
        uuid id PK
        uuid posting_id FK
        text provider
        text model
        text prompt_id "e.g. extract-requirements@v2"
        jsonb raw_response "audit / replay"
        text status "ok | schema_failed | flagged"
    }
    requirements {
        uuid id PK
        uuid extraction_run_id FK
        text kind "must_have | nice_to_have"
        text category "language | framework | domain | seniority | comp | location | other"
        text text
        text source_quote "verbatim from posting"
        bool quote_verified "string-matched against raw_text"
        real confidence
    }
    fit_reports {
        uuid id PK
        uuid posting_id FK
        uuid extraction_run_id FK
        text review_status "draft | reviewed"
        text notes
    }
    fit_sub_scores {
        uuid id PK
        uuid fit_report_id FK
        text dimension "min_quals | technical | domain | seniority | comp_location | priority | stretch"
        real score "0..1"
        text rationale "deterministic, rule-generated"
    }
    evidence_links {
        uuid id PK
        uuid requirement_id FK
        uuid profile_skill_id FK "nullable"
        uuid profile_project_id FK "nullable"
        text posting_quote
        text profile_quote
        text strength "direct | partial | adjacent"
    }
    gaps {
        uuid id PK
        uuid requirement_id FK
        uuid fit_report_id FK
        text classification "have | have_undemonstrated | needs_refresh | genuine_gap | low_priority"
        text rationale
        bool user_overridden
    }
    applications {
        uuid id PK
        uuid posting_id FK
        text stage "considering | applied | screen | interview | offer | rejected | withdrawn"
        date applied_on
    }
    application_events {
        uuid id PK
        uuid application_id FK
        text kind "stage_change | note | outcome"
        text detail
        date occurred_on
    }
    improvement_plans {
        uuid id PK
        uuid fit_report_id FK
        text review_status "draft | reviewed"
    }
    plan_items {
        uuid id PK
        uuid improvement_plan_id FK
        uuid gap_id FK
        text action
        text priority
        text status
    }
    learning_plans {
        uuid id PK
        uuid user_id FK
        text title
        text review_status "draft | reviewed"
    }
    exercises {
        uuid id PK
        uuid learning_plan_id FK
        text title
        text kind "kata | project | writeup | interview_drill"
        text status "planned | in_progress | complete"
    }
    mastery_evidence {
        uuid id PK
        uuid exercise_id FK
        text kind "implemented | tested | explained | revisited"
        text artifact_url
        date recorded_on
    }
    case_studies {
        uuid id PK
        uuid user_id FK
        uuid exercise_id FK "nullable"
        uuid profile_project_id FK "nullable"
        text title
        text provenance "professional | personal | personal_ai_assisted"
        text status "draft | published"
    }
```

Notes:

- **`gaps` ↔ `learning_plans` is many-to-many** via a `learning_plan_gaps` join table (elided in the diagram for readability).
- **Extraction is append-only**: re-running extraction creates a new `extraction_run`; old runs, raw responses, and prompt IDs are kept for audit and prompt-regression comparison.
- **The flywheel in data:** `application_events` outcomes → suggested weight adjustments on `search_criteria` (human-reviewed, M4) · completed `exercises` → `case_studies` drafts · `mastery_evidence` → `profile_skills.level` upgrades.

## 4. The Two-Stage Analysis Pipeline

The central design rule (ADR-0005/0006): **the LLM extracts, deterministic code scores.**

```mermaid
flowchart TD
    A[Pasted posting text] --> B["Sanitize + hash + store<br/>(untrusted, display-escaped)"]
    B --> C["LLM extraction<br/>posting as delimited data, no tools,<br/>JSON-schema-constrained output"]
    C --> D["zod validation<br/>reject/retry on schema failure"]
    D --> E["Evidence verification<br/>every quote must verbatim-match source<br/>else flagged unverified"]
    E --> F[("requirements + extraction_run")]
    F --> G["packages/scoring — DETERMINISTIC<br/>requirements × profile × search_criteria<br/>→ 7 sub-scores + gap classification,<br/>each with rationale + evidence links"]
    G --> H["Fit report (draft)"]
    H --> I{{"Carlos reviews<br/>(always)"}}
    I --> J["Improvement plan draft (LLM-assisted,<br/>evidence-cited) → reviewed"]
```

Why this split matters: scores are **reproducible and explainable** (same inputs → same sub-scores; every number traceable to a rule and a quote), the LLM's blast radius is limited to extraction quality (which the evidence-verification step audits), and prompt-injection payloads can at worst corrupt one extraction run — which flags rather than propagates (ADR-0006).

## 5. API Surface Sketch

Fastify with zod type-provider; OpenAPI generated from route schemas and served at `/docs` in dev. All routes except `/auth/login` and `/health` require a session. Mutating LLM operations are explicit POST verbs — nothing runs implicitly.

| Area | Endpoints (sketch) |
| --- | --- |
| System | `GET /health` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| Profile | `GET/PUT /profile` · `GET/POST/PATCH /profile/skills` · `/profile/experiences` · `/profile/projects` · `POST /profile/import` (re-parse `docs/profile/`) |
| Criteria | `GET/PUT /criteria` (structured search criteria) |
| Postings | `POST /postings` (paste) · `GET /postings` · `GET /postings/:id` · `POST /postings/:id/extract` · `GET /postings/:id/requirements` · `PATCH /postings/:id` (status) |
| Fit | `POST /postings/:id/fit` (run deterministic scoring) · `GET /postings/:id/fit` · `PATCH /fit-reports/:id` (review) |
| Gaps | `GET /fit-reports/:id/gaps` · `PATCH /gaps/:id` (override classification) |
| Plans | `POST /fit-reports/:id/improvement-plan` · `GET/PATCH /improvement-plans/:id` · `PATCH /plan-items/:id` |
| Applications | `POST/GET /applications` · `PATCH /applications/:id` · `POST /applications/:id/events` |
| Accelerator | `POST /learning-plans` (from gap ids) · `GET/PATCH /learning-plans/:id` · `POST/PATCH /exercises` · `POST /exercises/:id/evidence` · `GET /review-queue` (spaced revisits) · `POST /postings/:id/interview-prep` |
| Case studies | `POST /case-studies` (incl. draft-from-exercise) · `GET/PATCH /case-studies/:id` |

Conventions: JSON only; zod validation on every input; structured error shape `{ error: { code, message } }`; pino request logging with request IDs; no PII in logs.

## 6. Cross-Cutting Concerns

- **Validation:** zod at every boundary — API input, LLM output, env vars (fail fast at boot), profile import.
- **Logging:** pino structured JSON, request-scoped IDs, LLM calls logged with prompt ID + token usage + latency, never with full posting text or profile PII.
- **Testing:** Vitest unit tests everywhere; integration tests against dockerized Postgres for repositories and routes; `packages/scoring` gets exhaustive table-driven tests (it's pure); injection-payload suite in `packages/llm` runs in CI with a mocked provider (deterministic) plus an optional live smoke test.
- **Migrations:** Drizzle-kit generated SQL, checked in, forward-only, run via `pnpm db:migrate`.
- **CI (GitHub Actions):** typecheck + lint + test on every PR; portfolio build with Lighthouse and axe budgets; gitleaks secret scan. Main is always releasable.
- **Config/secrets:** `.env` local only, `.env.example` documents every variable, zod-validated at boot. The only secret in the MVP is the LLM API key (+ session secret).
- **LLM cost control:** extraction results cached by `content_hash × prompt_id`; re-extraction is an explicit user action; token usage recorded per run.

## 7. What We Are Deliberately Not Building

- Microservices, queues, or background workers — nothing here needs them yet; a synchronous request with a spinner is honest for a single user. If extraction latency hurts, the first step is an in-process job table, not infrastructure.
- Multi-tenancy, RBAC, teams — schema keeps the door open; product does not walk through it.
- Scraping/automated ingestion — excluded from MVP by constraint; future work gated by the legal invariants in RISKS.md.
- A design system framework for the platform UI — the *portfolio* gets the craft budget; the platform UI stays clean but utilitarian.

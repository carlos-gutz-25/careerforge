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
    CI["GitHub Actions CI"] -->|"build + quality gates"| PORT
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
└── .github/workflows/  # CI: typecheck, lint, test, portfolio build + Lighthouse/axe/link gates
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

**Portfolio deploy path (M2-01, 2026-07-19):** `apps/portfolio` is a Nuxt SSG site deployed to **GitHub Pages** from CI on merge to `main` (`.github/workflows/deploy.yml`; ADR-0008). Zero user-defined secrets — it publishes via the auto `GITHUB_TOKEN` + OIDC. The `ANY_INTERNAL` eslint wall (`packages/config/eslint.config.js`, `apps/portfolio/**`) enforces the boundary rule above: the portfolio imports no `@careerforge/*` package except `@careerforge/config`. The site serves from the apex root `/` (custom domain `carlosgutz.com`; ADR-0008 amended 2026-07-20, M2-11); the deploy build is plain `generate` — the same script the CI `portfolio-build` check invokes, so tested and deployed output cannot drift. Content is repo-authored and trusted; nothing from `docs/profile/` ever enters this app. Case studies live in a dedicated `caseStudies` content collection (`content/case-studies/*.md`) whose honesty schema — seven fixed sections, a required provenance label (professional / personal / personal, AI-assisted), and results sourced to a resolvable citation — is enforced by a deterministic build-time gate (`scripts/validate-case-studies.mjs`, run in `portfolio-build`; ADR-0010), because `@nuxt/content` performs no validation at ingest. M2-05 published the first studies (Heartland ×3) and M2-06 added two more (Love's + Nintendo), and M2-07 added Binventory + CareerForge (both `personal_ai_assisted`), seven in all, linked from the home page; Nitro prerenders each `/case-studies/<slug>/` from that crawl, and the quality gates (Lighthouse budgets, full axe, internal link/asset check) plus a provenance-label assertion (`scripts/assert-provenance.mjs`) now cover every case-study page as well as `/`. The professional studies' profile-derived, sensitivity-reviewed tokens cross the privacy boundary via the privacy-check publication allowlist (ADR-0011); CareerForge, published from its private staging draft, is instead handled by excluding that draft from privacy-check's structural extractors (ADR-0011 M2-07 amendment); sensitive classes stay fully detected. **M2-08** added the top-level home, about, and resume pages (`content/{index,about,resume}.md` rendered by dedicated pages in the `pages` collection): a name-forward home, the Nintendo→Love's→Heartland arc, and a public-reviewed resume mirror (no phone or home address; contact via a publish-safe email alias plus the LinkedIn profile URL). The axe and prerender-structure gates were extended to `/about/` and `/resume/` (Lighthouse and the internal link check already reach them via the `index.html` pattern and the home crawl); the one deliberately-published LinkedIn URL is a narrow exact-string carve-out in privacy-check, every other URL still detected (ADR-0011 M2-08 amendment).

## 3. Core Data Model

All tables carry `user_id` (single user today; multi-user is a migration, not a redesign — ADR-0007). Timestamps (`created_at`, `updated_at`) omitted below for brevity.

```mermaid
erDiagram
    users ||--o{ sessions : "authenticates via"
    users ||--o{ profile_skills : has
    users ||--o{ profile_experiences : has
    users ||--o{ profile_projects : has
    users ||--o{ profile_experience_bullets : has
    users ||--|| search_criteria : has
    users ||--o{ job_postings : ingests

    profile_experiences ||--o{ profile_projects : includes
    profile_experiences ||--o{ profile_experience_bullets : "has bullets"

    job_postings ||--o{ extraction_runs : "analyzed by"
    extraction_runs ||--o{ requirements : produces
    job_postings ||--o{ fit_reports : "scored in"
    fit_reports ||--o{ fit_sub_scores : "composed of"
    fit_sub_scores ||--o{ evidence_links : cites
    requirements ||--o{ evidence_links : "supported by"
    requirements ||--o{ gaps : "may become"
    fit_reports ||--o{ gaps : summarizes
    job_postings ||--o| applications : "tracked as"
    applications ||--o{ application_events : logs
    fit_reports ||--o| improvement_plans : "drafted from"
    fit_reports ||--o{ improvement_plan_runs : "drafting audited by"
    improvement_plans ||--o{ plan_items : contains
    gaps ||--o{ plan_items : "cited by"
    fit_reports ||--o| resume_variants : "tailored from"
    fit_reports ||--o{ resume_variant_runs : "tailoring audited by"
    resume_variants ||--o{ resume_variant_entries : contains
    resume_variant_entries ||--o{ resume_variant_citations : cites
    gaps ||--o{ resume_variant_citations : "cited by"

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
    sessions {
        uuid id PK
        uuid user_id FK
        text token_hash "sha-256; raw token only in the cookie"
        timestamptz expires_at
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
    profile_experience_bullets {
        uuid id PK
        uuid user_id FK
        uuid experience_id FK "CASCADE — bullets are intrinsic to the job"
        text text "user-authored; select/reorder/omit, never composed"
        int position "source order; UNIQUE (experience_id, position)"
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
        jsonb force_lowest_priority "cap to bottom tier, never exclusion (M1-08)"
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
        uuid user_id FK
        uuid posting_id FK
        text provider
        text model
        text prompt_id "e.g. extract-requirements@v2"
        jsonb raw_response "audit / replay (verbatim modulo NUL strip)"
        int input_tokens
        int output_tokens
        int cache_read_input_tokens
        int cache_creation_input_tokens
        int latency_ms
        int attempt "1, or 2 on the schema-failure retry"
        text status "ok | schema_failed | refusal | max_tokens | error | flagged"
    }
    requirements {
        uuid id PK
        uuid user_id FK
        uuid extraction_run_id FK
        text kind "must_have | nice_to_have"
        text category "language | framework | domain | seniority | comp | location | other"
        text text
        text source_quote "verbatim from posting"
        bool quote_verified "set inline at persist since M1-06; NULL only on pre-M1-06 rows until backfilled"
        real confidence
        int position "model output order, most significant first"
    }
    fit_reports {
        uuid id PK
        uuid user_id FK "ADR-0007 (M1-09)"
        uuid posting_id FK
        uuid extraction_run_id FK
        text verdict "scored | excluded — the explicit exclusion verdict at rest (M1-09)"
        jsonb exclusions "fired hard filters w/ quote evidence; empty iff scored"
        jsonb criteria_snapshot "exact criteria object scored (A1) — reports stay self-explaining after criteria edits"
        jsonb forced_lowest "force-lowest outcome at scoring time (A2; flag, never a score clamp)"
        bool input_flagged "the scored run was flagged (M1-06) — UI prominence"
        text review_status "draft | reviewed"
        text notes
    }
    fit_sub_scores {
        uuid id PK
        uuid user_id FK "ADR-0007 (M1-09)"
        uuid fit_report_id FK
        text dimension "min_quals | technical | domain | seniority | comp_location | priority | stretch; UNIQUE (report, dimension)"
        real score "0..1 (CHECK)"
        text rationale "deterministic, rule-generated"
    }
    evidence_links {
        uuid id PK
        uuid user_id FK "ADR-0007 (M1-09)"
        uuid fit_sub_score_id FK "report-side anchor (M1-09) — re-scoring never mingles evidence"
        uuid requirement_id FK
        uuid profile_skill_id FK "nullable, SET NULL"
        uuid profile_project_id FK "nullable, SET NULL"
        uuid profile_experience_id FK "nullable, SET NULL — adjacent evidence can be experience-derived (M1-09 D9)"
        text posting_quote
        text profile_quote
        text strength "direct | partial | adjacent"
    }
    gaps {
        uuid id PK
        uuid user_id FK "ADR-0007 (M1-11)"
        uuid fit_report_id FK "report-side anchor (M1-11) — re-scoring never mingles gap sets"
        uuid requirement_id FK
        text classification "have | have_undemonstrated | needs_refresh | genuine_gap | low_priority; EFFECTIVE value (engine or override); UNIQUE (report, requirement)"
        text engine_classification "the engine's fresh assignment, immutable (M1-11) — divergence from classification is the visible override-drift signal"
        text rationale "deterministic, rule-generated"
        bool user_overridden
        text override_note "nullable — an override records its why"
        text carried_via "requirement_id | content | NULL — how a carried override arrived (M1-11 A1)"
    }
    applications {
        uuid id PK
        uuid user_id FK
        uuid posting_id FK
        text stage "considering | applied | screen | interview | offer | rejected | withdrawn"
        date applied_on
    }
    application_events {
        uuid id PK
        uuid user_id FK
        uuid application_id FK
        text kind "stage_change | note | outcome"
        text detail
        date occurred_on
    }
    improvement_plan_runs {
        uuid id PK
        uuid user_id FK
        uuid fit_report_id FK
        text provider
        text model
        text prompt_id "e.g. improvement-plan@v1"
        jsonb raw_response "audit / replay (verbatim modulo NUL strip); embeds profile-derived text"
        int input_tokens
        int output_tokens
        int cache_read_input_tokens
        int cache_creation_input_tokens
        int latency_ms
        int attempt "1, or 2 on the schema-failure retry"
        text status "ok | schema_failed | refusal | max_tokens | error | flagged"
    }
    improvement_plans {
        uuid id PK
        uuid user_id FK
        uuid fit_report_id FK "UNIQUE - at most one plan per report"
        uuid drafting_run_id FK "the ok wire call this plan was parsed from"
        text review_status "draft | reviewed"
        text notes "nullable; captured by the one-shot review"
    }
    plan_items {
        uuid id PK
        uuid user_id FK
        uuid improvement_plan_id FK
        uuid gap_id FK "the citation - structural, never prose-parsed"
        text action "LLM-drafted; immutable"
        text priority "high | medium | low"
        text status "planned | in_progress | complete | dropped"
        int position "model output order"
    }
    resume_variant_runs {
        uuid id PK
        uuid user_id FK
        uuid fit_report_id FK
        text prompt_id
        jsonb raw_response "NUL-stripped; never logged, never on the wire"
        text status "ok | schema_failed | refusal | max_tokens | error | flagged"
        int attempt "1-based"
    }
    resume_variants {
        uuid id PK
        uuid user_id FK
        uuid fit_report_id FK "UNIQUE - the cache, no force lever"
        uuid tailoring_run_id FK "the ok, spec-valid wire call"
        text rendered_markdown "the snapshot review approves and export serves"
        text review_status "draft | reviewed"
        text notes
    }
    resume_variant_entries {
        uuid id PK
        uuid user_id FK
        uuid resume_variant_id FK
        text section "skill | experience | project"
        int position "server-assigned render slot"
        uuid profile_skill_id FK "SET NULL - navigation only"
        uuid profile_project_id FK "SET NULL"
        uuid profile_experience_id FK "SET NULL"
        text label "durable display SNAPSHOT"
        text detail
        text emphasis "lead | highlight | NULL"
        text reason "LLM rationale; present iff emphasis"
    }
    resume_variant_citations {
        uuid id PK
        uuid user_id FK
        uuid resume_variant_entry_id FK
        uuid gap_id FK "the citation - structural, never prose-parsed"
        int position
    }
    learning_plans {
        uuid id PK
        uuid user_id FK
        text title
        text review_status "draft | reviewed"
    }
    exercises {
        uuid id PK
        uuid user_id FK
        uuid learning_plan_id FK
        text title
        text kind "kata | project | writeup | interview_drill"
        text status "planned | in_progress | complete"
        int position "server-assigned append order"
        date completed_on "nullable; NOT NULL iff complete (CHECK, 0014)"
    }
    mastery_evidence {
        uuid id PK
        uuid user_id FK
        uuid exercise_id FK
        text kind "implemented | tested | explained | revisited"
        text artifact_url "nullable"
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
- **`exercises` ↔ `gaps` is many-to-many** via an `exercise_gaps` join table (elided for readability) — the gaps an exercise addresses (M3-02).
- **Extraction is append-only**: re-running extraction creates a new `extraction_run`; old runs, raw responses, and prompt IDs are kept for audit and prompt-regression comparison.
- **The flywheel in data:** `application_events` outcomes → suggested weight adjustments on `search_criteria` (human-reviewed, M4) · completed `exercises` → `case_studies` drafts · `mastery_evidence` → `profile_skills.level` upgrades.
- **Schema v1 amendments (M0-06, ratified 2026-07-13):** `sessions` added (absent from the original ERD; minimal M0-07-compatible shape). `user_id` added to `applications` and `application_events` — ADR-0007's "every table carries user_id" wins over the original diagram, which reached users only via `posting_id`. Enum-like columns are `text` + CHECK constraints derived from `packages/core` value sets (native pg enums rejected: `ALTER TYPE` fights forward-only migrations, ADR-0003). `applications.posting_id` is `ON DELETE RESTRICT` on purpose: postings with an application are archived (`status = 'archived'`), never deleted.
- **ERD addendum (M1-04, 2026-07-15 — `extraction_runs` still unbuilt; the table arrives with M1-05's migration):** the diagram now matches the M1-04 runner's `LlmCallRecord`, which is what M1-05's persistence sink will receive. Added columns: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (the per-run usage this document already promised in "token usage recorded per run"), `latency_ms`, and `attempt`. The `status` vocabulary is reconciled with the runner's typed outcomes: `ok | schema_failed | refusal | max_tokens | error` are set by the runner (refusal and max_tokens are NOT schema failures — a refusal is a content outcome, and max_tokens truncation is a prompt-config bug distinguished via stop_reason); `flagged` is applied post-hoc by evidence verification (M1-06) and never set by the runner.
- **ERD addendum (M1-05, 2026-07-16 — the tables are BUILT, migration 0003):** four deltas from the diagram as previously drawn, all now reflected above. (1) `user_id` on both tables — ADR-0007's "every table carries user_id" wins again (the applications precedent). (2) `requirements.position` — model output order (the prompt orders most-significant-first); rows have no inherent order and reads sort by it. (3) `quote_verified` is **nullable**: NULL = not yet verified; M1-06 sets true/false. (4) `extraction_runs.created_at` is written from the runner's clock (`LlmCallRecord.timestamp`, the now seam — external review F3), and `raw_response` is stored verbatim **modulo stripping real U+0000 CHARACTERS from string values and object keys** (Postgres jsonb rejects the character anywhere; losing the audit row is worse; the literal escape TEXT backslash-u-0000 survives byte-identical — external review R1). FK behavior: `posting_id` **cascades** (unlike `applications.posting_id`) because `raw_response` embeds posting text — a posting deletion must not strand its text in audit rows; deletion is not a feature today, this pins the privacy-coherent behavior if it becomes one.
- **ERD addendum (M1-06, 2026-07-17 — evidence verification built):** `quote_verified` is set **inline at persist** for every new extraction (the service computes deterministic whitespace-normalized verdicts via core's `verifyQuotes`; `persistExtraction` derives the final run's status AT INSERT TIME through the single policy site `deriveRunStatus` — `flagged` iff any verdict is false); pre-M1-06 NULL rows are covered by the idempotent `pnpm extraction:verify-quotes` backfill CLI (per-run transactions, counts/ids-only output). The **requirement-bearing** status set (`ok | flagged`, `REQUIREMENT_BEARING_STATUSES` in core) now keys the extract cache read, the GET requirements path, the posting flip, and the unarchive law — a flagged run stays served and its posting counts as extracted (flags mean human review, not absence). Column stays nullable by decision: a SET NOT NULL migration would demand backfill-before-migrate ordering on any env with data, for zero behavioral gain.

- **ERD addendum (M1-11, 2026-07-18 — gap classification built, migration 0006):** the `gaps` table lands per the amended shape above. Deltas from the original diagram, each ratified at the plan gate: (1) `user_id` — ADR-0007's "every table carries user_id" wins again (the fit-tables precedent). (2) `engine_classification` — the engine's fresh assignment is stored beside the effective `classification`, immutable, so an override that the engine now disagrees with is structurally visible, never prose-parsed. (3) `override_note` (nullable) — an override records its why; replaced wholesale on every PATCH (full-replacement semantics, no merge-patch). (4) `carried_via` (nullable, CHECK `requirement_id | content`) — the carry audit: how an override arrived on a re-score's row; NULL = fresh assignment or direct user PATCH. (5) `UNIQUE (fit_report_id, requirement_id)` — one classification per requirement per report. (6) The `requirements ||--o| gaps` edge is corrected to `||--o{`: gap sets are PER-REPORT, append-only artifacts written in the same transaction as their fit report — one requirement maps to one gap per report, many across appended reports. Enum-like columns are text + CHECK from `packages/core` value sets (M0-06 convention). Override carry-forward consults ONLY the posting's immediately prior report (latest by created_at/id at persist time): requirement_id binds across re-scores; a one-to-one whitespace-normalized text match binds across re-extractions (ambiguity on either side never carries); everything unbound surfaces as a loud `lostOverrides` count derived at read time with the same rules — an un-override is final, and no override is ever silently dropped. Unscored requirement rows (`quote_verified` false/NULL) get NO gap row: classification never builds on unverified content (M1-06).

- **ERD addendum (M1-12, 2026-07-19 — improvement plans built, migration 0007):** the three tables land per the amended shape above. Deltas from the original diagram, each ratified at the plan gate: (1) `improvement_plan_runs` — an entire audit table the diagram did not draw: recording is law (ADR-0005 §2, RISKS T-03), and the drafting call's rows mirror `extraction_runs` column-for-column minus `posting_id` plus `fit_report_id`, one row per WIRE CALL (the M1-05 law at its second call site); the plan row is created only from an `ok` run — the `extraction_runs` ↔ `requirements` parallel. `raw_response` embeds profile- and gap-derived text: never logged, never on the wire. (2) `user_id` on all three tables — ADR-0007's "every table carries user_id" wins again (5th application). (3) `created_at`/`updated_at` on all three (never drawn, always applied); `improvement_plan_runs.created_at` is written from the runner's clock. (4) `improvement_plans.drafting_run_id` — the audit anchor to the ok wire call, and the GET's run-selection contract (the run served under a plan is the plan's OWN drafting run, never latest-by-time — a lost concurrent-draft race could otherwise put the wrong run under the telemetry). (5) `improvement_plans.notes` — review-note parity with `fit_reports.notes`. (6) `UNIQUE improvement_plans.fit_report_id` — the drawn `||--o|` enforced in the DB (the `applications.posting_id` precedent); the UNIQUE is also the cache: an existing plan is served with no LLM call, and the lost leg of a concurrent double-draft commits its audit rows via ON CONFLICT DO NOTHING instead of aborting (honest telemetry). (7) `plan_items.position` — model output order (the `requirements.position` precedent). (8) Vocabularies (text + CHECK from `packages/core` value sets, M0-06 convention): `priority high|medium|low` and `status planned|in_progress|complete|dropped` were NOT drawn and are invented here — `planned|in_progress|complete` deliberately matches the drawn `exercises.status` family so sibling artifact tables share one terminal vocabulary when M3-02 lands, and `dropped` is the honest "I won't do this"; the run `status` vocabulary reuses the runner's five states plus post-hoc `flagged`, which for drafting means CITATION-validation failure (the model cited a gap ref that was never sent — the ADR-0006 layer-4 analog; such a run persists `flagged` with NO plan row). (9) FK on-delete CASCADE throughout — the report's derived-artifact family. The `plan_items.gap_id` cascade is total because gap rows can vanish by TWO routes — `gaps.fit_report_id` → fit_reports, and `gaps.requirement_id` → requirements → extraction_runs — and `fit_reports` ALSO cascades from `extraction_run_id`, so every real deletion origin (posting or extraction_run) removes the report, and with it the plan through its own `fit_report_id` FK, in the same statement. The `gaps ||--o{ plan_items` edge above makes the block's already-declared `gap_id` FK explicit (many items may cite one gap). PLAN-ITEM IDENTITY (the M1-09-R1 → M1-11-A1 lineage, decided at the gate): PIN-TO-REPORT — a plan is an append-only artifact of exactly ONE report; a re-score creates a new report with no plan until one is explicitly drafted (drafting is gated on a REVIEWED report, per §4's pipeline order); prior plans stay anchored to their reports, never mutated, never carried. Two named residuals ride the M1-13 friction log: a superseded plan (and its item progress) leaves the latest-report UI after a re-score, and a gap override landed AFTER drafting leaves items citing draft-time classifications beside the live value — visible but unexplained until a re-score.
- **ERD addendum (M2-10, 2026-07-23 — resume tailoring built, migration 0008; ADR-0012):** the four tables land as drawn, the `improvement_plans` family's twin at a third artifact ingress. The novel decisions: (1) **Spec, not prose** — the LLM emits only ordering + emphasis over server-assigned refs; a deterministic renderer builds `resume_variants.rendered_markdown` 100% from DB-row strings, so no table holds a field that can carry model-composed resume text (fabrication is unrepresentable, ADR-0012). (2) `resume_variant_runs` mirrors `improvement_plan_runs` column-for-column; its `status` `flagged` here means **SPEC-validation** failure — the model cited a ref that was never sent, or an order that is not an exact permutation of the sent refs (the ADR-0006 layer-4 analog; such a run persists `flagged` with NO variant row, via the repository's single policy site). (3) `UNIQUE resume_variants.fit_report_id` is the cache (an existing variant serves 200 with no LLM call; the lost leg of a concurrent double-tailor commits its audit rows via ON CONFLICT DO NOTHING). (4) **Server-assigned positions** — skills/projects from spec order, experiences from DB chronological order; `resume_variant_entries` has no model-facing experience-order field, so "reorder or omit an experience" is structurally unrepresentable (the ADR-0012 honesty invariant), pinned by `UNIQUE (resume_variant_id, section, position)`. (5) **The snapshot / mutable-profile hole** — `profile:import` is a full-sync, so the three profile FKs are `SET NULL` (navigation) and `label`/`detail`/`rendered_markdown` are durable snapshots frozen at draft time; a re-import cannot mutate a reviewed artifact (pinned by a repository test: re-import → FKs NULL, snapshots survive). (6) CHECKs `(emphasis IS NULL) = (reason IS NULL)` and per-section FK-nullness (only the matching profile FK may be non-null). (7) FK on-delete CASCADE throughout; the `resume_variant_citations.gap_id` cascade is total by the same both-route trace as `plan_items.gap_id` — a gap and its variant share the `fit_report` ancestor, and gaps/requirements are append-only, so every real deletion origin removes both routes in one statement (no orphan). VARIANT IDENTITY: PIN-TO-REPORT, append-only, review-gated tailoring — the plan-item lineage, restated; regeneration = re-score. Phase-1 scope (an emphasis guide over verified facts, not a bulleted resume) and the additive phase-2 story (M2-12, `profile_experience_bullets`) are recorded in ADR-0012.

- **ERD addendum (M2-12, 2026-07-23 — experience-bullet capture built, migration 0009; ADR-0012 phase 2):** one new table, `profile_experience_bullets`, additive/forward-only. (1) The M0-08 importer, which previously discarded resume bullet lines, now captures each experience's top-level `- ` bullets in source order; `syncProfile` mirrors them by `(experience_id, position)` (reword = update, shrunk tail = delete). (2) FK `experience_id` is **ON DELETE CASCADE** — bullets are intrinsic to their job (contrast `profile_projects`' SET NULL, where a project outlives its employer as a personal orphan). `user_id` CASCADE per ADR-0007; natural key `UNIQUE (experience_id, position)`. (3) A silent-omission import guard: a cleanly-parsed experience with more bullet-shaped lines than the flat capture took (an indented sub-bullet, a non-hyphen marker) flags `uncaptured-bullet` — unsupported structure is never dropped. (4) `resume-tailoring@v2` (new version, v1 untouched) adds `experienceBulletOrders`, a per-experience **SUBSET** selection over bullet refs `e{n}b{m}` — select/reorder/**omit** (unlike skill/project orders, which stay exact permutations), safe because the experience always renders (a job is never hidden even with every bullet deselected); `validateTailoringSpec` enforces membership + the ownership prefix. (5) **Export-only** this phase: bullets flow into the frozen `rendered_markdown` snapshot; the GET `/profile` and variant wire schemas strip them, so the web structured preview is unchanged (a future analytics story re-opens a variant-side bullet table). BULLET IDENTITY: user-authored true content, same trust class as project summaries — SELECTED, never composed (ADR-0006 intact).

- **ERD addendum (M3-01, 2026-07-24 — learning plans built, migration 0010; ADR-0013):** three new tables (`learning_plan_runs`, `learning_plans`, `learning_plan_gaps`), the fourth drafting-artifact family, additive/forward-only. Deltas from the sketched `learning_plans` shape, each ratified at the plan gate: (1) `learning_plan_runs` — the audit table (the `improvement_plan_runs` twin) mirrors it column-for-column but carries **NO `fit_report_id`**: a learning plan is drafted over a gap set selected ACROSS postings, so it has no single source report; `user_id` is the only anchor, and the plan points to its ok run via `drafting_run_id`. (2) `learning_plans` has **NO UNIQUE** — FREE-CREATE, plural by design (ADR-0013); the same gap set may seed two different plans, so there is no cache-200. If accidental double-charge ever needs preventing, the tool is a client idempotency key or debounce, never a schema UNIQUE. (3) `learning_plan_gaps` is the drawn `gaps }o--o{ learning_plans` many-to-many made concrete (the `learning_plan_gaps` join the diagram elided), carrying the model's drafted per-gap `focus`, `priority` (reused `PLAN_ITEM_PRIORITIES`), and `position` (drafted order, recurring gaps first); `UNIQUE (learning_plan_id, gap_id)` — a plan cannot cite a gap twice. No separate items table: concrete exercises are M3-02. (4) `learning_plan@v1` (new pinned prompt) emits a title + one focus per gap; the citation tripwire (`mapCitedRefs`) validates every cited gap ref against the sent set (the ADR-0006 layer-4 analog; a fabricated ref persists the run `flagged` with NO plan). (5) **Recurrence is SYNTACTIC and deterministic** — same `normalizeWhitespace(requirementText)` across ≥2 distinct **postings** ranks first (computed in the payload builder, never the model), a read-only borrower of the ADR-0006 verbatim normalizer (conservative: under-counts, never overclaims). (6) FK on-delete CASCADE throughout; the `learning_plan_gaps.gap_id` cascade means a citation vanishes only via its gap's own fit_report cascade. TWO NAMED RESIDUALS (multi-posting / user-only anchor): a hard posting deletion purges gaps + citations but not the run (`raw_response` holds model-OUTPUT prose only, not the un-stored evidence quotes — the first LLM audit table not purge-coherent by cascade), and a plan cited across postings cleanly loses one posting's citation rows while the plan persists smaller (no orphan). Mastery evidence and `profile_skills` upgrades are OUT (M3-06).

- **ERD addendum (M3-02, 2026-07-24 — exercises built, migration 0011; ADR-0013 family):** two new tables (`exercises`, `exercise_gaps`), additive/forward-only. An exercise is **USER-AUTHORED** (not LLM-drafted): plain deterministic CRUD, so **no run/audit table** and no new prompt (this is a schema-only story — no new ADR; ADR-0003/0007 and the ADR-0013 family cover it). Deltas from the sketched `exercises` shape, each ratified at the plan gate: (1) `user_id` — ADR-0007's "every table carries user_id" (6th application); `learning_plan_id` **ON DELETE CASCADE** (an exercise is a child of its plan). (2) `position` — **server-assigned append order** within the plan (no client-supplied position, no reorder surface; PATCH is status-only). Non-unique within a plan by decision (a display-order tie under concurrent create is acceptable at local-first scale — the `learning_plan_gaps.position` precedent). (3) Vocabularies are net-new own consts (text + CHECK from `packages/core`): `kind` = `kata|project|writeup|interview_drill`, and `status` = `planned|in_progress|complete` **exactly three values — NO `dropped`** (that is the LLM plan-item's honest "I won't do this"; a user simply DELETEs an abandoned exercise). This honors the M1-12 promise that `planned|in_progress|complete` is the shared terminal vocabulary across sibling artifact tables. (4) `exercise_gaps` is the `exercises }o--o{ gaps` many-to-many made concrete — the citation is **structural** (`gap_id` FK → `gaps.id` directly, the `learning_plan_gaps.gap_id` / `resume_variant_citations.gap_id` precedent), never prose-parsed; `UNIQUE (exercise_id, gap_id)` (an exercise cannot cite the same gap twice); both FKs and `user_id` **ON DELETE CASCADE**. (5) **Gap membership is a SERVICE precondition, not a schema FK**: a `POST /exercises` may cite only gaps the exercise's plan already cites (409 `EXERCISE_GAP_NOT_IN_PLAN`, after a plan-owned/exists 404), following ADR-0013's service-enforced-precondition precedent. **RESIDUAL TRIGGER (named, not fixed):** this is sufficient ONLY because no "un-cite a gap from a plan" mutation exists today — if a future story ever removes a gap from a plan **without deleting the gap**, `exercise_gaps` needs a companion cleanup pass (prune now-invalid links) OR a migration to a `learning_plan_gaps` join-row FK (which would make membership structural). (6) **D6 partial-survival residual (benign):** a gap deletion (only ever via its own `fit_report` cascade) removes that gap's `exercise_gaps` links; an exercise can lose **all** its links and persist link-less — no orphan, no dangling reference (it still belongs to its plan). Recourse for a mis-created exercise is **`DELETE /exercises/:id`** (owner-scoped hard delete, CASCADE clears its links). **Reads:** `GET /learning-plans/:id` embeds the plan's `exercises` (each carrying its `gapIds`) — the plan-scoped bidirectional view: an exercise shows its gaps, and (by inversion **within the plan being viewed**) a gap shows its exercises. A cross-plan gap→exercises read is a named future story (see BACKLOG Icebox); mastery evidence stays M3-03.

- **ERD addendum (M3-03, 2026-07-24 — mastery evidence built, migration 0012; ADR-0013 family):** one new table (`mastery_evidence`), additive/forward-only. A mastery-evidence row is **USER-AUTHORED** (not LLM-drafted): plain deterministic CRUD, so **no run/audit table** and no new prompt (schema-only story — **no new ADR**; the enforcement pattern is structurally identical to M3-02's D1 service precondition, which shipped with none — ADR-0003/0007 and the ADR-0013 family cover it). Deltas from the sketched `mastery_evidence` shape, each ratified at the plan gate: (1) `user_id` — ADR-0007's "every table carries user_id" (7th application); `exercise_id` **ON DELETE CASCADE** (evidence is a child of its exercise — deleting the exercise removes its evidence, no orphan). (2) `created_at`/`updated_at` (never drawn, always applied); `recorded_on` is **NOT NULL** (the service always supplies it — the client's date or the server's today, D7) and is the semantic "when the work happened," distinct from `created_at`'s insert instant. (3) `kind` is a net-new own core const `EVIDENCE_KINDS` (text + CHECK; `implemented|tested|explained|revisited`), a DISTINCT axis from `EVIDENCE_STRENGTHS` (M1-09 fit-link grading) — never conflated. (4) `artifact_url` is **nullable** (an `explained`/verbal record may carry no link); bounded + NUL-rejected at the wire boundary. (5) **NO UNIQUE constraint** by decision: a kind may RECUR — `revisited` is recorded repeatedly (M3-05), and multiple `implemented` artifacts are valid; the completion gate checks existence (≥1), never count. **THE COMPLETION GATE (D1) and the AIRTIGHT DELETE-GUARD (D2) are cross-table SERVICE preconditions, NOT schema constraints** — Postgres cannot express "an `exercises` row may reach `complete` only if ≥1 `implemented` AND ≥1 `tested` `mastery_evidence` row exists" as a CHECK (the M3-02 gap-membership precedent). (a) D1: `PATCH /exercises/:id → complete` is refused (409 `EXERCISE_INCOMPLETE_EVIDENCE`, after a 404 for a missing/foreign exercise) unless both required kinds exist. (b) D2: `DELETE /mastery-evidence/:id` is refused (409 `EVIDENCE_REQUIRED_FOR_COMPLETION`) when the parent exercise is `complete` and the row is its LAST `implemented` or LAST `tested` — so the gate is a true always-invariant, not just a transition check. **Reads:** `GET /learning-plans/:id` now embeds each exercise's `evidence[]` (M3-03 D4) via one batched `WHERE exercise_id IN (…)` query (no N+1); the embed shape is `exerciseWithEvidenceSchema` (POST/PATCH `/exercises` responses stay the bare `exerciseSchema`). **SCOPE:** M3-03 builds the evidence substrate + the completion gate; it writes NOTHING to `profile_skills.level` — the suggested-and-confirmed skill-level upgrade and the four field-ownership parks (field ownership / orphan-protection / second-writer / downgrade semantics) stay **M3-06**. The three cross-module reads (exercises←`hasRequiredEvidence`, learning←`listEvidenceByExerciseIds`, mastery→exercises `findExercise`) are injected as NARROW read-only interfaces (type-enforced, no reach-through mutation).

- **ERD addendum (M3-04, 2026-07-25 — interview-prep packs built, migration 0013; ADR-0013 family):** four new tables (`interview_prep_runs`, `interview_preps`, `interview_prep_questions`, `interview_prep_points`), additive/forward-only. A prep is **LLM-DRAFTED** — the FOURTH drafting ingress under ADR-0013's shared safety template (`interview-prep@v1`, new pinned prompt; **no new ADR** — ADR-0013's body pre-ratified this ingress by name) — and draft-until-reviewed like every generated artifact. **CARDINALITY (stated so no reader assumes the shared ADR's default): M3-04 is PIN-TO-REPORT (`UNIQUE (fit_report_id)`, the M1-12 improvement-plan pattern), the OPPOSITE of ADR-0013's free-create decision for M3-01 learning plans** — a prep summarizes exactly one fit report's verified state, so one prep per report, re-POST serves the existing prep (the UNIQUE is the cache), and regeneration = re-score. The routes are **POSTING-scoped** (`POST/GET /postings/:id/interview-prep` + `POST /interview-preps/:id/review`): the server resolves the posting's LATEST fit report and, for drafting, requires THAT report reviewed (409 `REPORT_NOT_REVIEWED` — never a silent fallback to an older reviewed report; the prep always reflects current scoring state). Payload law (ADR-0005 §3): drafting consumes ONLY the report's requirements with `quote_verified` **strictly `= true`** (the M1-06 tristate: `false` failed verification, `NULL` was never verified — both excluded; all-excluded = 409 `NO_VERIFIED_REQUIREMENTS` before any paid call), each with its gap row on THIS report where one exists (gap is 1:0..1 per (report, requirement); **a requirement with NO gap row carries no classification and no disclosure obligation** — absence is not "non-have"), evidence links capped 3/requirement and keyed to their requirement, and the profile skill summary. **Refs: requirements r1..rN, evidence e1..eM; GAPS CARRY NO REFS** — the model never addresses a gap directly; gap identity rides on the requirement and the server resolves the gap id + classification structurally (zero fabrication surface for gaps). **Tripwires (deterministic, server-side, ADR-0006 layer-4 analogs; one failure ⇒ run `flagged`, NOTHING written, re-POST is the manual retry):** (1) CITATION — every cited ref must be in the sent set AND every evidence ref must belong to ITS question's requirement (no cross-requirement bleed); (2) DISCLOSURE, **BIDIRECTIONAL** — a question on a requirement whose gap classification is any non-`have` value must carry ≥1 `gap_disclosure` point (a silent gap is treated like a fabricated citation), and a disclosure on an UNOBLIGED requirement (no gap row, or `have`) is equally flagged (it would stamp an incoherent badge or violate the point CHECK). **NAMED OMISSION RESIDUAL:** the disclosure tripwire prevents COMMISSION only — a model that simply never writes a question for a gapped requirement fires nothing, and that gap's learning-plan pointer never surfaces on the prep. Gaps are therefore NOT guaranteed to always surface here; the fit report and learning plan remain the complete gap views. Schema notes: `interview_prep_runs` mirrors `improvement_plan_runs` column-for-column (one row per WIRE CALL; `raw_response` UNTRUSTED + PRIVATE); `interview_prep_questions.requirement_id` is the structural citation (FK, never prose-parsed); `interview_prep_points` carries the **two-target CHECK** (`evidence` ⇒ `evidence_link_id` set + `gap_id` NULL; `gap_disclosure` ⇒ the inverse — the `resume_variant_entries_section_fk_check` implication form with NOT-NULL on the matching side); every row is CASCADE-reachable from the fit report (privacy-coherent deletes). **Wire honesty anchoring (server truth over model prose):** every `gap_disclosure` point on the wire carries the gap row's LIVE `classification` (server-resolved on every read — the UI badges from this, never from the drafted text, which is supplementary) plus a read-time `learningPlans` pointer (plans citing that gap via `learning_plan_gaps`, id + title, computed on every read and never stored — a plan created after drafting appears on the next GET; `[]` is the honest "not yet planned"; the LLM never sees or emits plan ids). Cross-module reads follow the M3-03 narrow-interface pattern (`LearningPlanPointerRead` is the ONLY learning-plan surface the interview module can touch).

- **ERD addendum (M3-05, 2026-07-25 — revisit scheduling built, migration 0014; ADR-0013 family):** ONE new column, no new table: `exercises.completed_on` (`date`, nullable, string-mode) — the anchor of the spaced-review ladder — paired with `exercises_completed_on_check` `CHECK ((status = 'complete') = (completed_on IS NOT NULL))`, a single-table invariant Postgres CAN express (contrast the cross-table D1/D2 service preconditions). Schema-only, NO LLM, no new ADR. Decisions, each ratified at the plan gate: (1) **Stamping is service-side** in `exercises.service.updateStatus` — the SOLE status mutator, which is what makes the CHECK zero-bypass (`createExercise` always defaults `planned`): server-local today on the transition INTO `complete`, PRESERVED on an idempotent complete→complete PATCH (epoch stability), cleared on the transition out; a re-completion restamps — a NEW revisit epoch by design. (2) **Migration 0014 is the repo's FIRST hand-edited SQL**: a backfill `UPDATE … SET completed_on = updated_at::date WHERE status = 'complete'` inserted between the generated ADD COLUMN and ADD CONSTRAINT (ordering proven by a scratch-DB replay test). The bound is honest: `updated_at` is the last status-PATCH instant, so the backfilled date is never LATE, but `::date` truncates in the DB session timezone — a legacy revisit can surface at most ~1 day early (benign for spaced review). (3) **The ladder is pure core logic** (`packages/core/src/revisit.ts`, `computeRevisitState`): ROLLING 7/30/90 — interval k is measured from the LAST counted revisit (or `completed_on` when none), so a late revisit never double-counts; after the third counted revisit the exercise GRADUATES and leaves the queue forever. Clock-free (the caller passes `today` from the injected now seam); day math is a local Hinnant `dayNumber`/`civilFromDays` pair (core cannot import scoring — dependency direction; scoring's private twin untouched). (4) **Strict `recorded_on > completed_on` epoch filter**: reject-future guarantees every existing `revisited` row is `<= today`, and a re-completion restamps to today, so an epoch reset excludes ALL old-epoch revisits — including same-day rows — with zero extra state. Deliberate cost: a genuine same-day revisit of a fresh completion does not advance the ladder. (5) **Graduation is COUNT-indexed, not spacing-enforced** (three consecutive-day revisits graduate in three days) — accepted per the product's evidence-is-trusted stance; the "a revisit counts only if it was actually due" refinement is a NAMED Icebox story (BACKLOG M3-05a). (6) **Zero new write surface**: completing a revisit IS `POST /mastery-evidence` with kind `revisited` (the M3-03 no-UNIQUE decision anticipated exactly this recurrence); the queue is a READ-ONLY projection recomputed on every `GET /review-queue` (due-only, sorted dueOn then id; nothing stored, nothing stale). `modules/review-queue/` holds no repository — it injects TWO narrow reads: net-new `ExerciseReviewRead` (`listCompletedExercises`) and the existing `MasteryEvidenceEmbedRead` (filtered to `revisited` in the service). `completed_on` is deliberately NOT on the Exercise wire shape — it surfaces only on review-queue items.

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

Fastify with zod type-provider; OpenAPI generated from route schemas and served at `/docs` in dev (M0-09: the interactive UI registers only outside production, and its routes are the only auth-guard exemptions beyond `/health` and `/auth/login` — marked public by a scoped hook in `apps/api/src/routes/docs.ts`). The spec is committed at `docs/api/openapi.json` (`pnpm openapi:generate`) and drift-checked by a vitest test inside `pnpm test`, so a route-schema change without a regenerated spec fails CI's required `test` check. The generator runs a dev-mode build, but the swagger-ui routes are marked `schema: { hide: true }` and @fastify/swagger excludes hidden routes — /docs is the only env-dependent surface, so the committed spec is also exactly the production API surface by construction. All routes except `/auth/login` and `/health` require a session. Mutating LLM operations are explicit POST verbs — nothing runs implicitly.

| Area | Endpoints (sketch) |
| --- | --- |
| System | `GET /health` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| Profile | `GET/PUT /profile` · `GET/POST/PATCH /profile/skills` · `/profile/experiences` · `/profile/projects` · `POST /profile/import` (re-parse `docs/profile/`) |
| Criteria | `GET/PUT /criteria` (structured search criteria) |
| Postings | `POST /postings` (paste) · `GET /postings` · `GET /postings/:id` · `POST /postings/:id/extract` · `GET /postings/:id/requirements` · `PATCH /postings/:id` (status) |
| Fit | `POST /postings/:id/fit` (run deterministic scoring; always scores fresh and appends) · `GET /postings/:id/fit` (latest report or `report: null`) · `POST /fit-reports/:id/review` (one-shot draft→reviewed with notes; delivered as a CAS-event POST rather than the PATCH originally sketched here — M1-10, recorded deviation) |
| Gaps | `GET /fit-reports/:id/gaps` · `PATCH /gaps/:id` (override classification) |
| Plans | `POST /fit-reports/:id/improvement-plan` (LLM drafting; requires a reviewed report; one plan per report — an existing plan serves 200 with no call) · `GET /fit-reports/:id/improvement-plan` (plan-or-null, report-scoped like the gaps read — recorded deviation from the `GET /improvement-plans/:id` originally sketched here, M1-12) · `POST /improvement-plans/:id/review` (one-shot draft→reviewed; CAS-event POST rather than the PATCH originally sketched — the M1-10 deviation's second application, M1-12) · `PATCH /plan-items/:id` (status + priority only; action/gap/position immutable) |
| Resume (M2-10) | `POST /fit-reports/:id/resume-variant` (LLM tailoring; requires a reviewed report; one variant per report — an existing variant serves 200 with no call; 409 NOTHING_TO_TAILOR before any paid call when the profile has no entities or the report no gaps) · `GET /fit-reports/:id/resume-variant` (variant-or-null, report-scoped, R2 run selection) · `POST /resume-variants/:id/review` (one-shot draft→reviewed CAS-event POST) · `GET /resume-variants/:id/export` (`text/markdown`, uuid-only attachment filename; **409s a draft** — only a reviewed variant exports; serves the stored `rendered_markdown` byte-for-byte, bypassing the zod JSON serializer) |
| Applications | `POST/GET /applications` · `GET /applications/:id` · `PATCH /applications/:id` · `POST /applications/:id/events` |
| Accelerator | `POST /learning-plans` (from gap ids) · `GET/PATCH /learning-plans/:id` · `POST/PATCH/DELETE /exercises` · `POST/DELETE /mastery-evidence` (recorded deviation from the `POST /exercises/:id/evidence` originally sketched here — evidence got its own module in M3-03; completing a revisit is this same POST with kind `revisited`) · `GET /review-queue` (spaced revisits, M3-05) · `POST /postings/:id/interview-prep` |
| Case studies | `POST /case-studies` (incl. draft-from-exercise) · `GET/PATCH /case-studies/:id` |

Ranking consumption contract (M1-10): no ranked posting list exists yet; `forced_lowest` is consumed at presentation (policy chip + cap marker beside the honest priority number). Any FUTURE ranked list MUST sort forced-lowest reports into the bottom tier regardless of scores — a cap, never a clamp and never an exclusion.

Conventions: JSON only; zod validation on every input; structured error shape `{ error: { code, message } }`; pino request logging with request IDs; no PII in logs.

## 6. Cross-Cutting Concerns

- **Validation:** zod at every boundary — API input, LLM output, env vars (fail fast at boot), profile import.
- **Logging:** pino structured JSON, request-scoped IDs, LLM calls logged with prompt ID + token usage + latency, never with full posting text or profile PII.
- **Testing:** Vitest unit tests everywhere; integration tests against dockerized Postgres for repositories and routes; `packages/scoring` gets exhaustive table-driven tests (it's pure); injection-payload suite in `packages/llm` runs in CI with a mocked provider (deterministic) plus an optional live smoke test.
- **Migrations:** Drizzle-kit generated SQL, checked in, forward-only, run via `pnpm db:migrate`.
- **CI (GitHub Actions):** typecheck + lint + test on every PR; portfolio build gated by Lighthouse budgets, full axe-core, and an internal link/asset check on `/` and every case-study page (ADR-0009, extended M2-05) plus a case-study content gate and a provenance-label assertion (ADR-0010); gitleaks secret scan. Main is always releasable.
- **Config/secrets:** `.env` local only, `.env.example` documents every variable, zod-validated at boot. The only secret in the MVP is the LLM API key (+ session secret).
- **LLM cost control:** extraction results cached by `content_hash × prompt_id`; re-extraction is an explicit user action; token usage recorded per run.

## 7. What We Are Deliberately Not Building

- Microservices, queues, or background workers — nothing here needs them yet; a synchronous request with a spinner is honest for a single user. If extraction latency hurts, the first step is an in-process job table, not infrastructure.
- Multi-tenancy, RBAC, teams — schema keeps the door open; product does not walk through it.
- Scraping/automated ingestion — excluded from MVP by constraint; future work gated by the legal invariants in RISKS.md.
- A design system framework for the platform UI — the *portfolio* gets the craft budget; the platform UI stays clean but utilitarian.

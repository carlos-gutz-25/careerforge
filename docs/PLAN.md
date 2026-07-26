# CareerForge — Product & Delivery Plan

**Status:** v1 shipped — roadmap complete (see [BACKLOG](./BACKLOG.md) for the delivery ledger) · **Owner:** Carlos Gutierrez · **Last updated:** 2026-07-26

---

## 1. Executive Summary

CareerForge is a personal career-development platform with three connected products:

1. **Job Intelligence Engine** — ingest job postings (manually pasted only, for the MVP), extract structured requirements with quoted evidence, score fit across seven explainable sub-scores, classify gaps into five honest buckets, generate role-specific improvement plans, and track applications end to end.
2. **Professional Portfolio** — a production-quality portfolio site with deep engineering case studies. The site itself is evidence: accessibility, performance, semantic HTML, CI/CD, and tests are enforced, not claimed.
3. **Engineering Skill Accelerator** — converts real gaps from real postings into learning plans, exercises, projects, and interview prep. Mastery requires evidence (implemented, tested, explained, revisited) — never passive reading.

**The flywheel:** the job engine finds gaps → the accelerator turns gaps into projects → completed projects become portfolio case studies → the portfolio strengthens applications → application outcomes feed back into matching.

**The meta-goal:** CareerForge is itself Carlos's strongest current employability artifact. It is a **public monorepo** demonstrating senior full-stack TypeScript work (Nuxt/Vue 3, Fastify, PostgreSQL, LLM integration done responsibly), while all personal career data stays gitignored and local. Every technical decision is recorded as an ADR that states its product, skill, or employability value.

**Honesty is a feature.** The system never fabricates resume content, never inflates claims, always distinguishes professional work from personal/AI-assisted projects, and every fit score and gap classification cites verbatim evidence from both the posting and the profile. Carlos reviews everything before any career action.

---

## 2. Product Boundaries

### 2.1 Job Intelligence Engine

| In scope (MVP) | Out of scope (MVP) |
| --- | --- |
| Paste a job posting as text | Any scraping, crawling, or automated collection |
| LLM extraction of structured requirements with quoted evidence | Auto-applying or auto-generating applications |
| Deterministic fit scoring: 7 sub-scores, each with rationale + evidence | A single opaque "match %" |
| Gap classification: have / have-but-undemonstrated / needs-refresh / genuine-gap / low-priority | Free-prose resume rewriting or fabricated bullets (M2-10 ships spec-driven reorder/emphasis of EXISTING verified content only — a tailoring guide, not composed prose; M2-12 adds SELECTION/reorder/omission of the user's own true experience bullets, still never composed; ADR-0012) |
| Role-specific improvement plan drafts (human-reviewed) | Sending anything anywhere on Carlos's behalf |
| Application tracking (stages, events, notes, outcomes) | Email/calendar integration (v2) |

**Later phases:** if automated collection is ever added, it must respect ToS, robots.txt, rate limits, and auth boundaries, and never bypass CAPTCHAs or anti-bot protections. This is an invariant, restated in RISKS.md.

### 2.2 Professional Portfolio

| In scope (MVP) | Out of scope (MVP) |
| --- | --- |
| Statically generated Nuxt site, publicly deployed from CI | CMS or admin UI |
| Case studies: problem, constraints, architecture, tradeoffs, testing, results, what-I'd-change | Blog (can come later) |
| Honest labeling: professional vs. personal vs. AI-assisted work | Anything not substantiable |
| A11y (axe), performance (Lighthouse budgets), semantic HTML enforced in CI | Comment systems, analytics beyond privacy-respecting basics |
| Case studies sourced from `docs/profile/projects.md`, Binnie, and CareerForge itself | Publishing employer-proprietary details |

### 2.3 Engineering Skill Accelerator

| In scope (MVP) | Out of scope (MVP) |
| --- | --- |
| Gap → learning plan (LLM-assisted draft citing posting evidence) | Generic course catalogs |
| Exercises/projects linked to specific gaps | Video content, community features |
| Mastery evidence: implemented / tested / explained / revisited | "Mastered" without evidence |
| Interview-prep pack per posting (honest talking points) | Scripted answers that overstate experience |
| Revisit scheduling (spaced review) | Gamification |

### 2.4 Shared platform

Single-user (Carlos) with real session auth; schema carries `user_id` so multi-user is possible later without redesign. Local-first: platform runs in Docker on Carlos's machine; only the portfolio is deployed publicly during the first 12 weeks.

---

## 3. Build Sequence

Fixed order (hard constraint): **Foundation → Job Intelligence MVP → Portfolio MVP → Skill Accelerator → Integrations.**

Rationale: the job engine produces immediate search value and generates the gap data everything else consumes; the portfolio has a hard external deadline (Carlos is already applying — manual track from week 1 — and needs the public site strengthening those applications as soon as possible); the accelerator is only as good as the real gaps feeding it; integrations close the flywheel last, when both ends exist.

## 4. MVP Definition

**The platform MVP is done when this works end to end, locally, with Carlos reviewing every step:**

> Paste a real job posting → structured requirements appear, each with a verbatim quote from the posting → a fit report shows seven sub-scores (min-quals, technical, domain, seniority, comp/location, priority, stretch), each with a rationale and quoted evidence from both the posting and the profile → unmet requirements are classified into the five gap buckets → a draft improvement plan is generated for review → the application is tracked through stages with outcomes recorded.

**Exit gate for M1:** by end of week 6 the tool has scored **at least 5 real postings from Carlos's already-active search** and its fit reports are informing live applications. Applying is not gated on the tool — it started in week 1. The gate verifies the tool is *useful*; if it isn't improving an already-running search by week 6, that is a product failure to be addressed before building more.

The **portfolio MVP** is done when the site is live on a custom domain, passes Lighthouse and axe budgets in CI, and contains at least 6 case studies with honest labeling.

---

## 5. 12-Week Roadmap

Assumes full-time effort (30–40 hrs/wk). Each week ends with working, tested, committed software (or published docs). Milestone detail and acceptance criteria live in [BACKLOG.md](./BACKLOG.md).

### M0 — Foundation (Weeks 1–2)

| Week | Deliverables |
| --- | --- |
| **1** | Privacy guardrails **before first commit**: `.gitignore` for `docs/profile/`, sanitized `docs/profile.example/`, gitleaks pre-commit hook. pnpm workspace scaffold; shared tsconfig/eslint/vitest config; docker compose (Postgres 16); Fastify skeleton (health route, pino, zod-validated env, error handler); GitHub Actions CI (typecheck + lint + test) green on main. |
| **2** | Drizzle schema v1 + migrations (users, sessions, profile tables, search_criteria, job_postings, applications); session auth (login/logout, protected routes); profile importer (parses `docs/profile/` markdown → DB, with example-profile fixtures for tests); OpenAPI docs generated from route schemas; Nuxt `apps/web` shell with login and authenticated layout. |

### M1 — Job Intelligence MVP (Weeks 3–6)

| Week | Deliverables |
| --- | --- |
| **3** | Posting ingestion: paste → sanitize → dedupe (content hash) → store. Posting list/detail UI (sanitized rendering — posting text is untrusted). Application tracking: stages, events, notes. |
| **4** | `packages/llm`: `LlmProvider` interface + Anthropic adapter + versioned prompt registry. Extraction pipeline: posting → structured requirements (zod-validated JSON) with quoted evidence + confidence. **Verbatim evidence verification** (quotes must string-match the source or get flagged unverified). Prompt-injection payload test suite running in CI. |
| **5** | `packages/scoring`: deterministic fit engine producing the 7 sub-scores from extracted requirements × structured profile × search criteria (imported from `job-criteria.md` hard filters and scoring signals). Fit report UI with per-sub-score rationale and evidence from both sides. |
| **6** | Gap classification (5 buckets) with review/override UI. Improvement-plan draft generation (LLM-assisted, evidence-cited, human-reviewed). **Dogfood gate: score ≥5 real postings from the active search; fit reports informing live applications.** Friction log → backlog. M1 retro. |

### M2 — Portfolio MVP (Weeks 7–9)

| Week | Deliverables |
| --- | --- |
| **7** | `apps/portfolio` scaffold: Nuxt SSG + Nuxt Content, design tokens, accessible base components, semantic HTML. CI quality gates: Lighthouse budgets, axe checks. Static-host deploy pipeline + domain. |
| **8** | Case-study template (problem / constraints / architecture / tradeoffs / testing / results / what-I'd-change) with professional-vs-personal-vs-AI-assisted labeling. Heartland case studies ×3 (analytics platform, Redis/Snowflake caching, pricing rules engine). |
| **9** | Remaining case studies: Love's, Nintendo, Binnie, CareerForge (live, evolving). Home / about / resume pages. Publish; verify with Lighthouse, axe, keyboard-only and screen-reader pass, mobile check. |

### M3 — Skill Accelerator (Weeks 10–11)

| Week | Deliverables |
| --- | --- |
| **10** | Learning-plan generation from selected gaps (LLM draft citing the posting evidence that created the gap). Exercise/project model linked to gaps. Mastery-evidence tracking: a skill is only "mastered" with implemented + tested + explained + revisited evidence. |
| **11** | Interview-prep pack per posting (likely questions derived from requirements; honest talking points that cite real experience only). Revisit scheduling (spaced review queue). Mastery evidence upgrades `profile_skills` levels. Dogfood on Carlos's top real gaps. |

### M4 — Integrations & Hardening (Week 12)

| Week | Deliverables |
| --- | --- |
| **12** | Completed exercise → case-study draft flow. Application outcomes → scoring/criteria feedback (weight hints, human-reviewed). Platform-deployment ADR (decide; implement only if trivial). Docs refresh, v2 backlog, retro. |

### Parallel track (weeks 1–12)

Real job applications run from **week 1**, manually, with the existing resume — applying is not gated on the tool existing. From week 6 the tool augments the search (fit reports, gap-aware targeting, interview prep); the tool catches up to the search, never the reverse. Tool-building never gets to displace applying (see RISKS.md, risk P-02).

---

## 6. Success Criteria for the 12 Weeks

1. **Hired-track:** applying continuously from week 1, with fit reports materially improving targeting and interview prep from week 6.
2. **Evidence-track:** a public monorepo a hiring manager can read (architecture, ADRs, tests, CI, security thinking) and a live portfolio with ≥6 honest case studies.
3. **Skill-track:** at least 2 genuine gaps from real postings converted into completed, evidence-backed exercises.

## 7. v2 Roadmap (post-12-week; planned 2026-07-26)

The 12-week roadmap (section 5) shipped v1: a Job Intelligence Engine, a live portfolio, and a
Skill Accelerator. v2 turns that into a **Resume Studio** (compose an honest, tailored resume and
export it), deeper **Coaching** (typed recommendations + an application gameplan), a **design
overhaul** of both frontends, and a **public demo** on Azure with fictional data only. Every v2
story with acceptance criteria lives in [BACKLOG.md](./BACKLOG.md) under its milestone section
(M5-M11); the full design rationale lands in the reserved ADRs (see 7.3). This section is the shape.

### 7.1 Operator decisions (2026-07-26, confirmed)

1. **Deploy target:** Azure Container Apps (~$12-15/mo; the ADR-0015 amendment path).
2. **Deployed data:** a public demo on the fictional `docs/profile.example/` only (= ADR-0015
   trigger 3). Real data stays local forever.
3. **Resume export:** PDF + DOCX from one structured source (markdown/plaintext/JSON near-free extras).
4. **Resume prose:** **LLM-drafted with a deterministic provenance gate** (chosen over selection-only).
   ADR-0012's by-construction guarantee evolves to by-validation + human review; the gate is the heart
   of the design.
5. **Aesthetics:** "Provenance Ledger" (portfolio) + "Dusk Console" (platform app).
6. **Demo LLM posture:** no `ANTHROPIC_API_KEY` in Azure at all; pre-seeded real artifacts; drafting
   disabled with honest UI.
7. **Sequence:** Resume (Track A) and Design (Track B) proceed in parallel; the Azure demo is serial
   after both tracks' cores.
8. **Design tokens:** duplicate the grammar per app; a shared `@careerforge/design` package is parked
   as a named v2.1 candidate.

Standing v1 invariants carry forward unchanged: local-first for real data, new-prompt-version-plus-pin,
untrusted posting text, draft-until-reviewed, planted-FAIL per gate change, forward-only migrations,
the module walls, and Carlos's per-PR merge word with an external one-glance for executable/gate content.

### 7.2 Milestones (weeks are indicative; stories in BACKLOG)

| Milestone | Focus |
| --- | --- |
| **M5 - Groundwork** (week 1, serial) | Binnie rename + retired-name gate; these v2 roadmap docs + ADR stubs; parallel-dev harness (per-lane test DB + ports). |
| **M6 - Resume Studio** (weeks 1-4, Track A) | Profile foundation (contact/education/summaries); claim-provenance gate; `resume-compose@v1`; compose service/tables; `packages/resume-render` (PDF/DOCX + parse audit); ATS coverage scorer. |
| **M7 - Coaching** (weeks 4-6, Track A) | Typed `improvement-plan@v2` recommendations (no-URL law); `application-gameplan@v1` (never-send layers); their UIs. |
| **M8 - Design & UI** (weeks 1-6, Track B) | Two identities/one grammar; portfolio "Provenance Ledger"; platform "Dusk Console" (contrast gate + no-raw-hex ratchet); shell redesign + the missing feature surfaces. |
| **M9 - Skill Signal + Dogfood** (week 7) | Operator dogfood closes the v1 skill criterion; market-signal aggregation (Sharpen/Prove/Build/Certify); demo blueprints. |
| **M10 - Azure Public Demo** (weeks 8-9, serial) | Containerize; demo mode; Bicep + OIDC deploy; go-live on fictional data. |
| **M11 - Proof & Launch** (week 10) | Operator dogfood on real roles; CareerForge case study v2; v2 retro + v2.1 backlog. |

### 7.3 Architecture direction and reserved ADRs

The flagship is **Resume Studio, composed-with-provenance**: deterministic facts (contact, education,
skills, experience entities, section order, rendering) stay outside LLM authority; the LLM drafts the
summary and bullets as **claim objects** carrying citation refs; a pure **claim-provenance gate**
(`packages/scoring`, server-side, flag-the-run-write-nothing) enforces citation membership, a numeric
law, a vocabulary law, a structural provenance-class law, and the untrusted-text law; then
draft-until-reviewed with export blocked on drafts. The named residual (evidenced-token overstatement)
is human review's job, stated plainly.

v2 introduces six ADRs. Their **names are final; their numbers are assigned at merge order (0016+)**,
so each is reserved now as an unnumbered `docs/DECISIONS/RESERVED-<slug>.md` stub and renamed to its
number when its owning story merges:

- **Resume Studio: composed-with-provenance** (supersedes-in-part ADR-0012) - M6-02/M6-04
- **External-recommendation honesty** (no-URL law) - M7-01
- **Application gameplan** (new artifact class; never-send layers) - M7-05/M7-07
- **Design system** (two identities, one grammar, no shared package) - M8-01
- **Public demo deployment** (ACA/Bicep/GHCR/OIDC; discharges ADR-0015 trigger 3) - M10-05
- **Demo mode semantics** (key-absent + pre-generated artifacts; nightly reset) - M10-05

### 7.4 v2 success criteria

1. **Resume-track:** a fictional profile composes a tailored resume, the provenance gate demonstrably
   rejects a tampered fabricated-number claim, the doc is reviewed, and it exports to PDF + DOCX that
   pass the parse audit.
2. **Design-track:** both frontends ship their identity off tokenized `light-dark()` palettes with the
   contrast gate enforcing; the portfolio's CI budgets are never lowered.
3. **Demo-track:** a public Azure instance serves the fictional profile with drafting honestly
   disabled, no real data or ANTHROPIC key present, resettable nightly.

## 8. Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, monorepo layout, data model (ERD), API sketch
- [DECISIONS/](./DECISIONS/) — ADRs 0001–0015 (v2 ADRs 0016+ reserved as `RESERVED-*.md` stubs, numbered at merge)
- [BACKLOG.md](./BACKLOG.md) — prioritized stories with acceptance criteria per milestone
- [RISKS.md](./RISKS.md) — security, privacy, legal, and scope risks with mitigations
- [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) — decisions still needed from Carlos

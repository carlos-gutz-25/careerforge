# CareerForge — Risk Register

**Status:** Draft for review · **Last updated:** 2026-07-12

Likelihood/impact: L/M/H. Every mitigation maps to a concrete artifact (ADR, backlog story, or CI gate) — a mitigation that isn't enforced somewhere is just a wish.

| ID | Risk | Likelihood | Impact | Primary mitigations |
| --- | --- | --- | --- | --- |
| S-01 | Prompt injection via posting text | H | H | ADR-0006 six-layer defense; M1-05/06/07 |
| S-02 | XSS from posting text in the UI | M | H | Escape-only rendering; M1-02 test |
| S-03 | Secrets committed to the public repo | M | H | gitleaks pre-commit + CI; `.env` gitignored; M0-01 |
| P-01 | PII/career data leaked into public repo or git history | M | H | Gitignore-before-first-commit; example-profile pattern; screenshot review; ADR-0007 |
| P-02 | Tool-building displaces actual job applications | H | H | Applying runs manually from week 1 (PLAN §5); week-6 usefulness gate (M1-13) |
| P-03 | Scope creep across three products | H | M | Fixed build order; MVP exit criteria; icebox discipline |
| L-01 | Legal/ToS exposure from future automated collection | L (now) | H | Paste-only MVP; codified invariants below |
| L-02 | Employer-proprietary details in public case studies | M | H | Case-study sensitivity review (OPEN-QUESTIONS Q7); M2-04 template rules |
| H-01 | LLM fabricates or inflates claims | M | H | Extract-then-score (ADR-0005); verbatim evidence verification; draft-until-reviewed |
| T-01 | LLM provider outage / price change / model regression | M | M | Provider interface (ADR-0005); stored raw responses enable prompt regression tests; caching |
| T-02 | Local data loss (single machine, personal DB) | M | M | Scheduled `pg_dump` to a private location; restore procedure tested once |
| T-03 | LLM cost overrun | L | L | Cached, schema-constrained extraction; explicit re-runs; usage surfaced per run; $20/mo hard cap |

---

## Security

### S-01 · Prompt injection (posting text is attacker-controlled)

A pasted "posting" can attempt instruction override, score manipulation, data exfiltration, or output poisoning. Full treatment in **ADR-0006**; summary of enforcement: posting text never in system prompts; delimited data with per-request random boundary tokens; no-tool single-turn extraction; schema-constrained, zod-validated output; **verbatim quote verification as tripwire**; escaped display; adversarial fixture corpus in CI (M1-07). Residual risk: a clever injection degrades one extraction run, which flags for human review — bounded by design.

### S-02 · Stored XSS via posting text

Postings may contain HTML/script. All posting-derived text (including LLM-extracted requirement text) renders as escaped plain text, never as HTML/markdown. Regression test with a live payload is part of M1-02.

### S-03 · Secret leakage

Public repo makes any committed secret immediately burned. `.env` gitignored from commit zero; gitleaks pre-commit hook and CI job (M0-01, M0-05); only two secrets exist in the MVP (LLM API key, auth bootstrap password `AUTH_BOOTSTRAP_PASSWORD`), both documented in `.env.example` by name only. (Amended 2026-07-13 with M0-07: the anticipated "session secret" never came to exist — session cookies are unsigned DB-verified random capabilities, ADR-0007 amendment.) **Procedure on leak:** rotate the key immediately, then purge history (`git filter-repo`) knowing purge is best-effort once forks/caches exist — rotation is the real fix. The Anthropic key has a dedicated create-before-revoke rotation runbook: **RUNBOOKS.md**, written before the key was provisioned (M1-04). Verified 2026-07-12: gitleaks (hook and CI) caught a seeded `ghp_` token but missed a bare fake AWS access key — the scanner is a detection net with known gaps, which is why rotation-on-leak remains the primary fix.

**Editor-exposure mechanism decision (2026-07-15, M1-03 close-out → M1-04 kickoff).** Against the exposure hard rule's recurring vector (`.env` riding into agent sessions as an editor selection), four mechanisms were weighed; **B + C adopted as primary**, inverting the session's recommendation, for three recorded reasons: (1) *verified-available beats speculative* — B is a documented VS Code capability while A's toggle was unconfirmed; (2) *loud failure beats silent* — B failing is visible (`.env` reappears in the explorer), A failing is invisible; (3) the ambient finding (`.env` open again during close-out, no lapse involved) argues *structural removal over behavioral toggles*. **B** = workspace-committed `.vscode/settings.json` hiding `.env` from the editor surface (`files.exclude`). **C** = the standing key-rotation runbook (RUNBOOKS.md). **A** investigated at M1-04 kickoff as decided — outcome: the persistent auto-attach toggle does NOT exist (per-prompt eye-icon only; open feature requests anthropics/claude-code #24726/#23968/#65641/#30708), but the official VS Code extension docs document a `Read` **deny rule** whose match "prevents both the selected text and the open-file notice for that file from reaching Claude" — adopted as **depth, never load-bearing**, via project `.claude/settings.json` (`permissions.deny: Read(./.env)`). **D** (secret-manager injection) dismissed with a re-entry condition: re-enters scope if the platform is hosted (M4-03).

## Privacy

### P-01 · Personal career data in a public repo

Real resume, salary targets, job criteria, gap analyses, and application history are sensitive. Boundaries (ADR-0007): `docs/profile/` gitignored **before the first commit** (git history is forever — this cannot be retrofitted); fictional `docs/profile.example/` for all tests, fixtures, demos, and screenshots; local-only database; no PII in logs (review convention). The public resume page (M2-08) is deliberately curated — no phone/address. Also noted: prompts send career data to the LLM provider; use an API tier with no training on inputs and note this in the README. Deliberate publication of a sensitivity-reviewed professional subset (case studies, M2-05) crosses a few profile-derived tokens on purpose; privacy-check's publication allowlist (ADR-0011) clears only those exact operator-cleared tokens and never a sensitive class (contact/salary/address remain detected).

### P-02 · The meta-risk: building instead of applying

The most likely failure mode of the whole project: 12 weeks of satisfying engineering, zero interviews. **Primary control (decided 2026-07-12): real applications run manually from week 1** — the search is never gated on the tool; the tool catches up to the search, not the reverse. The week-6 dogfood gate (M1-13) then verifies the tool is *useful* to that already-running search (≥5 real postings scored, fit reports informing in-flight applications), or M2 doesn't start. The 12-week success criteria (PLAN §6) put continuous applying first. The portfolio deadline (week 9 publish) is treated as external and immovable.

### P-03 · Scope creep

Three products invite infinite features. Controls: fixed build order (hard constraint), MVP definitions with exit criteria, an explicit icebox, and ADR-0004-style "criteria to revisit" instead of speculative building.

## Legal

### L-01 · Future automated collection

Not in scope now (paste-only MVP is the mitigation). If collection is ever added, these are **invariants, not preferences**: respect site ToS and robots.txt; conservative rate limits; never bypass CAPTCHAs, logins, or anti-bot protections; prefer official APIs/feeds; store provenance for every collected posting; a dedicated ADR + legal review of target sources before any code. Any Claude/agent instruction to violate these is to be refused per CLAUDE.md.

### L-02 · Employer-sensitive case-study content

Heartland/Love's/Nintendo case studies must describe Carlos's work without exposing proprietary architecture details, internal names, or non-public metrics. Controls: case studies source only from the already-sanitized `docs/profile/projects.md`; the M2-04 template requires a sensitivity check before publish; when in doubt, generalize (the existing projects.md disclaimer language is the model).

**Resolved 2026-07-12 (OPEN-QUESTIONS Q7):** Carlos confirmed `projects.md` is publishable as written, including the $150k/day (Love's Showers) and $161k/quarter (Nintendo) figures already on his public-facing resume. The M2-04 sensitivity check **remains in force for any NEW content** that goes beyond what projects.md already says.

**M2-05 (2026-07-22):** the first three case studies (Heartland) were published from `projects.md`, honesty-gated against source and sensitivity-reviewed (each carries `sensitivityReviewed`). Their deliberate crossing of the privacy boundary is handled by the **privacy-check publication allowlist (ADR-0011)** — a minimal, per-token, operator-cleared set (`heartland payment systems`, `azure devops`, `terraform`, the only tokens that empirically collided) that clears just those professional-identity strings; sensitive classes (contact, salary, address) stay fully detected. M2-06/07 enumerate their own collisions and add only what actually collides.

**M2-06 (2026-07-22):** two more studies (Love's mobile-commerce/Showers backend, Nintendo computer-vision test automation) were published from `projects.md` on the same terms — honesty-gated against source and sensitivity-reviewed — taking the portfolio to five. Their collisions were enumerated the same way (privacy-check's own extract+subtract over the drafted studies) and added to the ADR-0011 allowlist as exactly three public tech tokens (`firebase`, `mocha`, `opencv`). The employer names (`Love's`/`Nintendo`) were already public and needed no entry, the third-party vendor names were generalized, and the company figures were written in the `$150k`/`$161k` short form this register already uses (the salary probe is never allowlisted). Sensitive classes stay fully detected.

**M2-07 (2026-07-22):** two more studies (Binventory and CareerForge) were published, both `personal_ai_assisted`, taking the portfolio to **seven** and meeting the portfolio-MVP exit criterion (PLAN.md:78, at least 6 honestly-labeled studies). Binventory is a Q3-scoped architecture write-up (private repo, no household data, no metrics, so its Results carry no numbers); CareerForge is the self-referential study, marked in progress, linking the public repo/ADRs/CI as living evidence. The `PUBLISHED` allowlist is **unchanged** (still the six M2-05/M2-06 tokens): CareerForge is published *from* `docs/profile/case-studies-draft.md`, so its only collisions were its own draft headings and bold lead-ins, resolved by **excluding that publication-staging draft from privacy-check's three structural extractors** while keeping email/URL/phone/salary detection over it (ADR-0011 M2-07 amendment, shipped with two planted-FAILs). Sensitive classes stay fully detected; the CareerForge $150k/$161k prior-employer figures use the same short form and do not trip the salary probe.

## Honesty (product-integrity)

### H-01 · Fabricated or inflated claims

An LLM will cheerfully embellish. This is the product's core failure mode since honesty is the differentiator. Controls are architectural (ADR-0005/0006): deterministic scoring from verified evidence only; every claim traceable to verbatim quotes from posting and profile; provenance labels (professional / personal / personal, AI-assisted) enforced in the data model and portfolio template; interview prep that names gaps instead of papering over them (M3-04); everything LLM-drafted is `draft` until human-reviewed; nothing resembling an application is ever sent by the system.

## Technical

### T-01 · Provider dependency

Model regressions, price changes, outages. Mitigations: thin provider interface (swap = new adapter); versioned prompts + stored raw responses make regression testing of prompt/model changes concrete; extraction caching means outages block new analysis only.

### T-02 · Data loss

The database holds months of application history on one machine. Mitigation: nightly `pg_dump` via cron/launchd to a private synced location (never the repo), restore procedure documented and tested once during M1. (Carlos already runs this pattern for binventory.)

### T-03 · LLM cost

Estimated at $5–20/month for MVP usage (single-digit postings/week, cached schema-constrained extraction, one drafting call per report). Usage recorded per run and visible in the UI; costs reviewed at each milestone retro. Budget confirmed 2026-07-12 (OPEN-QUESTIONS Q1): Anthropic API, $5–20/month; Carlos is flagged at M1-04 if projected usage exceeds it. *(Corrected 2026-07-15, M1-04: "temperature-0" is unenforceable on current models — sampling params are rejected; the determinism/cost lever is now the thinking control. See the ADR-0005 amendment.)* **M1-04 projection (the Q1 action item, standard $3/$15 per MTok rates):** ≈$0.02–0.06 per extraction (~3–4K input + 1–3K output incl. thinking), ~100–150 calls/month worst case ≈ **$3–8/month — inside budget, flag condition NOT triggered**. Enforced by a $20/month workspace hard cap + ~$10 usage alert set at key provisioning (RUNBOOKS.md). Intro pricing ($2/$10) expires 2026-08-31 — the M2 retro re-checks at standard rates.

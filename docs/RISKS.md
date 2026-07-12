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
| T-03 | LLM cost overrun | L | L | Temperature-0 cached extraction; explicit re-runs; usage surfaced per run |

---

## Security

### S-01 · Prompt injection (posting text is attacker-controlled)

A pasted "posting" can attempt instruction override, score manipulation, data exfiltration, or output poisoning. Full treatment in **ADR-0006**; summary of enforcement: posting text never in system prompts; delimited data with per-request random boundary tokens; no-tool single-turn extraction; schema-constrained, zod-validated output; **verbatim quote verification as tripwire**; escaped display; adversarial fixture corpus in CI (M1-07). Residual risk: a clever injection degrades one extraction run, which flags for human review — bounded by design.

### S-02 · Stored XSS via posting text

Postings may contain HTML/script. All posting-derived text (including LLM-extracted requirement text) renders as escaped plain text, never as HTML/markdown. Regression test with a live payload is part of M1-02.

### S-03 · Secret leakage

Public repo makes any committed secret immediately burned. `.env` gitignored from commit zero; gitleaks pre-commit hook and CI job (M0-01, M0-05); only two secrets exist in the MVP (LLM API key, session secret), both documented in `.env.example` by name only. **Procedure on leak:** rotate the key immediately, then purge history (`git filter-repo`) knowing purge is best-effort once forks/caches exist — rotation is the real fix.

## Privacy

### P-01 · Personal career data in a public repo

Real resume, salary targets, job criteria, gap analyses, and application history are sensitive. Boundaries (ADR-0007): `docs/profile/` gitignored **before the first commit** (git history is forever — this cannot be retrofitted); fictional `docs/profile.example/` for all tests, fixtures, demos, and screenshots; local-only database; no PII in logs (review convention). The public resume page (M2-08) is deliberately curated — no phone/address. Also noted: prompts send career data to the LLM provider; use an API tier with no training on inputs and note this in the README.

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

## Honesty (product-integrity)

### H-01 · Fabricated or inflated claims

An LLM will cheerfully embellish. This is the product's core failure mode since honesty is the differentiator. Controls are architectural (ADR-0005/0006): deterministic scoring from verified evidence only; every claim traceable to verbatim quotes from posting and profile; provenance labels (professional / personal / personal, AI-assisted) enforced in the data model and portfolio template; interview prep that names gaps instead of papering over them (M3-04); everything LLM-drafted is `draft` until human-reviewed; nothing resembling an application is ever sent by the system.

## Technical

### T-01 · Provider dependency

Model regressions, price changes, outages. Mitigations: thin provider interface (swap = new adapter); versioned prompts + stored raw responses make regression testing of prompt/model changes concrete; extraction caching means outages block new analysis only.

### T-02 · Data loss

The database holds months of application history on one machine. Mitigation: nightly `pg_dump` via cron/launchd to a private synced location (never the repo), restore procedure documented and tested once during M1. (Carlos already runs this pattern for binventory.)

### T-03 · LLM cost

Estimated at $5–20/month for MVP usage (single-digit postings/week, temperature-0 cached extraction, one drafting call per report). Usage recorded per run and visible in the UI; costs reviewed at each milestone retro. Budget confirmed 2026-07-12 (OPEN-QUESTIONS Q1): Anthropic API, $5–20/month; Carlos is flagged at M1-04 if projected usage exceeds it.

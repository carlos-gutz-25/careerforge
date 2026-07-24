# ADR-0013: Learning-plan drafting (Skill Accelerator)

**Status:** Accepted · **Date:** 2026-07-24

## Context

M3 (Skill Accelerator) converts real gaps from real postings into learning plans. M3-01, its first
story, drafts a **learning plan** from a set of gaps the user selects — gaps that may span **multiple
postings** — with an LLM focus per gap, prioritized, draft-until-reviewed.

The M1-12 improvement-plan machinery is the near-exact template: verified-structured-data-only input
(ADR-0005 §3), a synthetic-ref citation surface validated against the sent set (the ADR-0006 layer-4
analog), the audit-run ledger, and the review-gated CAS. The genuinely new decisions are (a) a learning
plan is **not** pinned one-per-fit-report the way an improvement plan is, (b) "recurring gaps rank
higher" needs a defined, honest recurrence key, and (c) drafting spans multiple source reports. This is
the third drafting-family LLM ingress (after improvement-plan and resume-tailoring), so it also owes a
new adversarial corpus and a live pass per version (the ADR-0012 precedent).

This is a **new ADR, not an amendment** to ADR-0005/0006/0012 (the ADR-0010/0012 "mint new, don't
amend" reasoning): it *uses* those layers rather than changing them.

## Decision

- **Free-create, plural by design.** A learning plan is a titled, user-curated artifact drafted over a
  selected gap-id set; there is no single fit report to pin to, so `learning_plans` has **no UNIQUE and
  no cache** — every successful `POST /learning-plans` is a fresh plan (201). Two POSTs of the same gap
  set legitimately create two different plans. (Contrast improvement-plan's `UNIQUE(fit_report_id)`
  cache-200.)
- **Focus-on-join.** The model emits a plan title plus one `focus` per cited gap; the focus + priority +
  drafted position live on the `learning_plan_gaps` many-to-many join row (no separate items table).
  Concrete exercises are M3-02, a distinct downstream artifact.
- **Reviewed-gate spans every source report.** Drafting consumes post-review effective classifications
  (ADR-0005 §3), so **every** selected gap's source fit report must be `reviewed` — a 409 before any
  paid call (the multi-report analog of improvement-plan's single-report gate). Preconditions run in
  order pre-paid: gaps owned/exist (404) → all reports reviewed (409) → eligible (non-`have`) count > 0
  (409).
- **Recurrence is SYNTACTIC, deterministic, never the model's judgment.** "Recurring gaps rank higher"
  means: the same `normalizeWhitespace(requirementText)` appearing in **≥2 distinct source postings**
  among the selection. Computed in the payload builder, fed as `seenInNPostings`, used to order gaps
  (recurring first); the prompt is instructed to honor that order. It is NOT semantic skill clustering —
  the product never asserts a recurrence it cannot structurally prove. Distinct **postings**, not
  reports: re-scoring one posting yields multiple reports but must not inflate recurrence.
- **Read-only borrower of `normalizeWhitespace`.** Recurrence reuses the ADR-0006 verbatim
  quote-verification normalizer (documented "must never loosen"). Reusing the verbatim (case- and
  punctuation-sensitive) normalizer keeps recurrence conservative — it can only **under-count, never
  overclaim**. If recurrence semantics ever need loosening (e.g. case-insensitive), **fork a NEW
  normalizer** (the `normalizeForMatching` split is the precedent) — never edit `normalizeWhitespace`.
- **New pinned prompt `learning-plan@v1`.** A new version file + registration + a `pins.ts` content-hash
  line (the resume-tailoring@v1→v2 precedent; `registry.test.ts` enforces it). Posting-derived text
  (requirement strings, evidence quotes) reaches it, so it owes a fictional `adversarial/learning/`
  corpus + a live pass per version. `interview-prep@v1` (M3-04) will be a fourth such ingress under this
  same ADR.
- **The citation tripwire transplants unchanged.** `mapCitedRefs` validates every cited ref against the
  sent set; one fabricated ref flags the run and writes NO plan (honesty keystone). Never fabricates
  content; draft-until-reviewed; escaped on display (`learning_plan_gaps.focus` is UNTRUSTED — never
  rendered as HTML/markdown, RISKS S-02).

## Alternatives Considered

- **Gap-set-hash cache (a `UNIQUE` on the normalized sorted gap-id set).** Rejected as the default: it
  prevents a user from intentionally drafting two different plans from overlapping gaps, and a learning
  plan is genuinely a curated artifact, not a deterministic function of a report. If accidental
  double-charge ever needs preventing, the tool is a **client idempotency key or debounce, NOT a schema
  UNIQUE** — a future "add a cache" story must not break plural-by-design.
- **A separate `learning_plan_items` table.** Rejected: the per-gap focus fits the existing M2M join,
  keeping M3-01 ERD-consistent (only `exercises` hang off a plan). Revisit if items ever need attributes
  the join cannot carry.
- **Semantic recurrence clustering.** Deferred: syntactic (same normalized string) is provable; semantic
  clustering is a separate scoring-layer story if ever wanted.
- **One merged item per recurring requirement.** Rejected: N selected instances stay N items ranked by
  `seenInNPostings`, preserving the one-item-to-one-gapRef citation surface; display-time grouping is a
  later UI concern.

## Consequences

- New DB schema (3 tables, migration 0010) + a new LLM prompt version ⇒ plan-gate domains; delivered
  under the M3-01 plan with the generated SQL walked through at a stop-the-line before the slice
  proceeded.
- **Two named residuals**, both stemming from the multi-posting / user-only anchor (the M1-01
  self-blinding ratchet residual is the precedent for naming rather than fixing):
  1. **Purge-coherence deviation.** `learning_plan_runs` is anchored only to `user_id` (no single report
     to cascade from). A hard posting deletion purges the gaps and citation rows but **not the run**,
     whose `raw_response` holds model-OUTPUT prose derived from that posting. Bounded and accepted:
     `raw_response` stores the response only (verbatim evidence quotes live in the un-stored request
     payload) and the platform is single-user-local. This is the **first LLM audit table not
     purge-coherent by cascade** — the multi-source analog of the ratchet residual.
  2. **Partial-survival (benign).** A plan cited across several postings cleanly loses its citation rows
     + focus text if one source posting is deleted (`learning_plan_gaps.gap_id` CASCADE) while the plan
     row persists smaller. No orphan, no dangling reference.
- **Scope boundary.** Mastery evidence and `profile_skills` level upgrades are **out** of M3-01 (the
  M3-06 ADR owns the four parked constraints: field ownership, orphan-protection, the second profile
  writer, downgrade semantics). M3-03's "no complete without implemented + tested" is a forward note,
  settled when M3-03 is planned.

## Value

- **Product:** turns the deterministic gap classifier's output into an actionable, prioritized,
  evidence-cited learning plan across the user's whole application pipeline — the recurring-gap ranking
  surfaces what to learn first because it recurs across the real postings the user is chasing.
- **Skills:** exercises the additive-prompt-version discipline, a deterministic-ranking-over-LLM
  boundary, and honest recurrence (provable, conservative, under-counts) — transferable judgment about
  keeping factual claims out of the model.
- **Employability:** the plan is grounded only in verified gaps and real posting evidence, never
  fabricated — the same honesty-first differentiator that runs through the résumé and fit surfaces,
  extended to skill development.

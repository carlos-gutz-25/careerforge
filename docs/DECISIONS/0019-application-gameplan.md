# ADR-0019: Application gameplan (new artifact class)

**Status:** Accepted · **Date:** 2026-07-27

## Context

M7 (Coaching, v2) adds a third LLM-drafted coaching artifact alongside improvement plans (M1-12 /
M7-02) and interview prep (M3-04): the **application gameplan**. Given a scored fit report, it drafts
a short strategy for pursuing that specific posting - one overall `strategySummary`, one
`phaseStrategy` for each active-pursuit phase (`apply | screen | interview | offer`), and 0..6 STAR
`stories` the candidate can lean on, each story citing at least one piece of verified evidence that
belongs to a requirement the story targets. The UI (M7-09, lane B2) presents the one artifact as three
views (Apply / Speak / Process); this ADR governs the whole feature, which is built in five stories:
**M7-05 (this story) the foundation** - this ADR, the core vocabularies + checklist templates +
`looksLikeOutreach` util, and the six-table schema/migration, all born with tests but with **no
runtime caller**; M7-06 the `application-gameplan@v1` prompt + payload + pin; M7-07 the repository +
service + routes + the two server tripwires + their planted-FAIL detection proofs; M7-08 the
never-send adversarial corpus + live legs; M7-09 the UI.

The honesty hazard that shapes every decision here is the one CLAUDE.md names most sharply: **the
system never sends anything resembling an application, and everything LLM-generated is
draft-until-reviewed.** A gameplan is coaching about *how to pursue* a posting - strategy and
reflection - and it must never become a drafted outreach message (a cover-letter paragraph, an email
to a recruiter, a LinkedIn note). The failure mode is the model emitting sendable prose instead of
strategy. This is a different hazard from the existing tripwires: ADR-0006 layer 4 checks that a model
cited only what was sent it, and ADR-0017's no-URL law (`containsExternalPointer`) checks that a
drafted field carries no external pointer. Neither catches "the model wrote something that looks like a
message you could send." That is the gap this artifact class must close structurally, not just by
asking the prompt nicely.

The pattern basis is the M3-04 interview-prep template verbatim: an LLM-drafted, pin-to-report,
posting-scoped, reviewed-inputs-only artifact with a per-wire-call audit (`*_runs`) table (ADR-0006),
draft-until-reviewed review workflow (ADR-0005), and privacy-coherent cascade deletes (a posting or
extraction-run deletion removes the whole artifact). Every table carries `user_id` (ADR-0007);
migrations are forward-only drizzle-kit SQL (ADR-0003); untrusted posting text is delimited data with
a per-request random boundary token, never in a system prompt (ADR-0006); the drafting prompt lives in
the versioned registry as a new version + pin (ADR-0005).

## Decision

Adopt the application gameplan as a new drafting artifact class with the following shape and defenses.

**The artifact.** One `application_gameplans` row per fit report (pin-to-report: `UNIQUE(fit_report_id)`
- regeneration is a re-draft, never an in-place overwrite), carrying the single `strategySummary`
(<=600 chars) and the `draft | reviewed` review workflow (a one-shot review CAS, M7-07). Its children:
exactly one `gameplan_phase_strategies` row per gameplan phase (each strategy <=600 chars), and 0..6
`gameplan_stories` STAR rows (each of `situation | task | action | result` <=300 chars). Each story
carries >=1 `gameplan_story_citations` grandchild pointing at a verified `evidence_links` row that must
belong to a requirement the story targets. A code-owned checklist (deterministic, never LLM-authored)
is toggled per gameplan in `gameplan_checks`. Inputs are reviewed-only: verified requirements + gaps +
evidence, plus improvement-plan items only when reviewed. The caps (<=600 / <=300 / <=6) are enforced
at the zod boundary (the M7-06 prompt `outputSchema` and the M7-07 validator), not as DB length CHECKs
- the interview-prep precedent, where the DB pins vocabularies and cardinalities and zod pins lengths.

**The four-layer never-send defense (defense in depth, CLAUDE.md line 22).** Named with the story that
owns each layer, outermost-structural first:

- **L1 - no message-shaped field exists in the schema (this story, M7-05).** None of the six tables
  carries a `to` / `from` / `recipient` / `subject` / `body` / `message` / `email_address` /
  `salutation` / `signature` column. Every text column is strategy, reflection, or STAR-story content.
  You cannot send what the schema cannot hold; this is the strongest guarantee because it is structural
  and unrepresentable to violate. A structural test greps the schema file's column identifiers against
  the forbidden message-shaped set and fails if any appears.
- **L2 - a strengthened prompt (M7-06).** `application-gameplan@v1` instructs strategy and reflection
  output and explicitly never a drafted message, under the ADR-0006 delimited-untrusted-input contract.
- **L3 - the deterministic `looksLikeOutreach` message-likeness tripwire (util here, enforced M7-07).**
  A pure guard that flags line-anchored outreach structure (salutations, sign-offs, `Subject:` headers,
  embedded emails). At M7-07 it runs over every drafted free-text field; a hit flags the run and writes
  nothing (flag-the-run-write-nothing). This story authors the util with unit tests; it enforces it
  nowhere.
- **L4 - no send surface exists (standing product fact).** CareerForge has no feature anywhere that
  transmits a message to a third party; there is nothing to send *to*, by construction.

**The two M7-07 tripwires (both owe their planted-FAIL detection proofs THERE, not here).**
(a) **message-likeness**: `looksLikeOutreach` fires on any drafted gameplan field -> flag the run,
persist nothing; (b) **story-citation provenance**: every story must carry >=1 `evidenceRef`, and each
cited evidence must belong to a requirement the story targets - the interview-prep
cross-requirement-bleed check applied to STAR stories; a fabricated ref or one that bleeds across
requirements -> flag. Additionally the **no-URL law** (`containsExternalPointer`, ADR-0017, reused not
re-authored) applies to every drafted free-text field. M7-05 authors `looksLikeOutreach` the util and
reuses `containsExternalPointer`; it enforces neither - the server tripwires and their demonstrated
detections are M7-07, exactly as M7-01a authored `containsExternalPointer` and deferred its server
enforcement + planted-FAIL to M7-03.

**Deterministic (non-LLM) parts.** The four gameplan phases are a code constant **derived from
`APPLICATION_STAGES`** (the active-pursuit subset: `applied | screen | interview | offer`, with the
tracker's `applied` presented as the gameplan phase `apply`), pinned by a derivation test so that
changing the application lifecycle forces the phase set to be reconsidered rather than silently
drifting. The checklist templates (which items exist, their labels, their phase grouping) are
code-owned in `packages/core` and never LLM-authored; `gameplan_checks` stores only per-gameplan toggle
state, keyed by a stable `check_key` from the code-derived closed set. The read-time timeline overlay
(mapping `application_events` stage changes onto phases) and the read-time pointers to sibling
artifacts (improvement plan, interview prep) are join-time reads M7-07 assembles - never stored, never
LLM-visible: they are not columns and not payload fields.

**Run statuses.** A separate `GAMEPLAN_DRAFTING_RUN_STATUSES` const (`ok | schema_failed | refusal |
max_tokens | error | flagged`) with the values copied verbatim from the sibling drafting families - the
`PLAN_REVIEW_STATUSES` / `RESUME_VARIANT_RUN_STATUSES` convention where a new drafting family declares
its own named const so the two workflows evolve independently. The runner sets the five wire statuses;
`flagged` is applied post-hoc by the M7-07 tripwires (it carries *both* tripwire failures and any
no-URL hit as one status; the specific reason surfaces via value-free telemetry counts, never a new
status value) and is never set by the runner.

## Alternatives Considered

- **A drafted-message field guarded only at runtime.** Rejected: a schema that *can* hold a message is
  one L3 bug away from persisting one. L1 (no such column) makes the strongest guarantee free and
  permanent; runtime guards are the backstop, not the floor.
- **Reuse `PLAN_DRAFTING_RUN_STATUSES` directly (as interview-prep did).** A legitimate one-line import
  swap with no logic change. Chosen against because the gameplan is explicitly a new family with two
  bespoke tripwires whose status set could plausibly diverge (a future gameplan-only terminal state);
  the enums.ts convention favors a separate const, and reversal is trivial if ever wanted.
- **Fewer/more tables.** Merging phase strategies onto `application_gameplans` as a jsonb blob loses the
  per-phase enumCheck + UNIQUE + queryability and blobs a fixed-4-key schema; merging story citations
  into `gameplan_stories` as an array loses the row-per-citation provenance ledger the story-citation
  tripwire resolves against; a `gameplan_phases` lookup table treats a code constant as data (the
  derivation test keeps it honest instead). Six tables (runs + artifact + two child collections +
  citation grandchild + checks) is the natural decomposition, mirroring interview-prep generalized to
  the gameplan's two child collections plus checks.
- **Phases as a free vocabulary independent of `APPLICATION_STAGES`.** Rejected: the phases *are* the
  active-pursuit subset of the tracking lifecycle; deriving them (with a test) means the two cannot
  silently disagree and the read-time timeline overlay has a single mapping.

## Consequences

- The six tables ship **born unused** (no repository, no route reads or writes them) until M7-07 - the
  same "authored + tested, no runtime caller" posture ADR-0017 established for `containsExternalPointer`
  at M7-01a and M7-02 reused for `improvement-plan@v2`. A `pnpm db:migrate` creates empty tables. This
  is deliberate: shipping the repository here would mean an untested-by-tripwire persist path plus a
  repository with no caller - strictly worse than a clean schema-only floor.
- Because M7-05 changes **no verification gate** (no CI check, no drift test, no allowlist, no
  cli-smoke, no privacy-check; `looksLikeOutreach` is a library function, not a gate), **no planted-FAIL
  is owed at M7-05**. The demonstrated-detection proofs for both server tripwires are owed at M7-07,
  exactly as M7-01a deferred `containsExternalPointer`'s proof to M7-03.
- **The commission-only never-send residual, named honestly (the ADR-0017 residual-naming precedent).**
  `looksLikeOutreach` catches *structural* outreach markers - line-anchored salutations, sign-offs,
  `Subject:` headers, embedded emails. A model could still emit outreach-shaped *prose* carrying none of
  those markers (a paragraph that reads like a cover letter but opens with no salutation line). That
  residual is caught only by human review under draft-until-reviewed. The guard is deliberately
  conservative and over-flags to review rather than passing silently; L1 (the schema holds no message
  field) bounds the exposure regardless. No guard closes this residual - this ADR names it rather than
  papering over it.
- **Two operational costs recorded so a future want is a recognized schema change, not a surprise 500
  (folded from the review-seat audit):**
  - **(A) Template growth is a forward-only-migration event.** The `gameplan_checks.check_key` column is
    an `enumCheck` baked against `GAMEPLAN_CHECK_KEYS` (derived from the code-owned templates), so the
    DDL CHECK pins the exact key set at migrate time. Adding, removing, or renaming a checklist template
    later therefore requires a follow-up forward-only migration to refresh that constraint - the closed
    key set trades cheap DB-level integrity (no unknown key can be inserted) for a migration whenever the
    template roster changes. This is the intended trade (checklist items are a stable, code-reviewed
    roster, not user data); it is named here so template growth is planned, not a runtime insert failure.
  - **(B) Pin-to-report is cache-once, not supersede.** `application_gameplans.UNIQUE(fit_report_id)`
    means at most one gameplan per report; M7-07's persist uses `onConflictDoNothing(target:
    fit_report_id)` for race safety. The regeneration semantics M7-07 gets are therefore **cache-forever**
    (the first ok, tripwire-clean draft is the artifact; a re-draft is a no-op while a row exists) - the
    interview-prep precedent. If a future story wants supersede-style revisions (regenerate replaces the
    prior draft), that is a recognized schema change (a delete-then-redraft under the unique, or a
    versioned artifact), not an improvisation - stated here so it is a decision, not a discovery.
- Migration-slot discipline (single open migration repo-wide, ADR-0003 / charter): the six-table
  migration takes the slot only when free and is bound to the firsthand lowest-free number at execution
  (never hard-coded from the plan); it is never left open overnight.
- The read-time timeline overlay and sibling-artifact pointers add no columns and no LLM-visible fields;
  they are pure join-time reads, keeping the artifact's stored surface minimal and the LLM's input
  reviewed-only.

## Value

- **Product:** a strategy-and-story coach that turns a scored posting into an apply/screen/interview/
  offer gameplan the candidate can actually act on - without ever drafting something sendable. The user
  gets tactics and rehearsed STAR stories grounded in their own verified evidence, and the system's
  refusal to write the email is a feature, not a limitation.
- **Skills:** layered-defense security design (the strongest guarantee is structural - a field that does
  not exist cannot leak), a deterministic-vs-LLM split with derivation-tested vocabularies, and the
  discipline of settling a law and its enforcement primitives (the schema floor, the message-likeness
  util) before any prompt or route depends on them.
- **Employability:** demonstrates honesty-first product judgement under a real temptation - the obvious
  "helpful" feature is to draft the outreach message, and the trustworthy product is the one that
  structurally refuses. A system that will not fabricate a sendable application, and enforces that in
  the schema rather than in prose, is the differentiator that runs through every CareerForge surface.

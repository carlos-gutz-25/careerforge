# ADR-0012: Spec-not-prose resume tailoring

**Status:** Accepted · **Date:** 2026-07-23

## Context

M2-10 (Q5 promotion) delivers per-posting resume tailoring: from a **reviewed** fit report, produce
a draft that reorders and emphasizes the candidate's **existing verified profile content** for a
specific posting, every emphasis citing the requirement/evidence that motivated it, never fabricating
content (the standing law; ADR-0006 lineage). Export is markdown-first, manual, never auto-sent
(PLAN.md; RISKS). Generated variants embed real profile data, so they are local-only artifacts,
never committed (P-01).

**The shape of the profile decides the architecture.** The DB holds no resume prose. `profile_skills`
= name/category/level/years/lastUsed; `profile_experiences` = company/title/dates only;
`profile_projects` = name/provenance/summary; the M0-08 importer captures **no bullets** — the rich
prose lives only in gitignored `docs/profile/resume.md`. A tailoring stage that composed resume text
would therefore be composing text the system cannot verify against a source, which is exactly the
product's core failure mode (fabrication, RISKS H-01).

## Decision

**The LLM is structurally barred from composing resume text.** It emits only a **tailoring spec** over
server-assigned ref codes, and a **deterministic renderer** builds the markdown 100% from DB-row
strings + the spec. Fabrication is impossible by construction, not by prompt.

- **Spec, not prose (the honesty keystone).** The `resume-tailoring@v1` output schema has **no field
  that can carry resume text**: it is `skillOrder` (a permutation of skill refs), `projectOrder` (a
  permutation of project refs), and `emphases` (each an entity ref + ≥1 gap ref + an emphasis level +
  a capped free-text `reason`). The model's entire authority is ordering, emphasis, and a cited
  rationale. Every body string in the rendered document comes from a DB row (the user's own verified
  content, same trust class as their resume.md); the model contributes no prose to the body.

- **Judgment-framed rationale, never a fact claim.** The `reason` is the only free-text the model
  emits. It is prompted and rendered as JUDGMENT — "emphasized in light of &lt;requirement&gt;" — never
  as a fact ("&lt;skill&gt; satisfies &lt;requirement&gt;"). The looser (entity, gap) association below is
  honest precisely because the template never asserts a fact about fit.

- **Deterministic spec validation (the layer-4 analog).** `validateTailoringSpec` (pure) enforces
  membership (every cited entity/gap ref was in the sent set) AND both-direction permutation
  (`skillOrder`/`projectOrder` each an exact permutation of the sent refs — **reorder-only, never
  drop**, because omission is misrepresentation and dropping content is a post-export human decision).
  ANY violation ⇒ the run persists `flagged` via the repository's single policy site
  (`deriveResumeRunStatus`) and **NO variant row is written**. This is the M1-12 citation-validation
  lineage; `fabricatedRefCount`/`missingRefCount` are value-free telemetry. Deliberately NOT required:
  an `evidence_links` row connecting the exact (entity, gap) pair — the model's adjacent-relevance
  judgment is its residual value, and the citation is the gap (requirement + classification +
  evidence), rendered when present.

- **The mutable-profile hole → snapshot at draft time.** `pnpm profile:import` is a full-sync
  (upsert + delete-absent). FK-only entries would let a re-import silently mutate or orphan a
  *reviewed* artifact. Resolution: entries carry durable `label`/`detail` **snapshots**, and the
  variant stores its fully rendered markdown; review and export operate on the stored bytes; the three
  profile FKs are `ON DELETE SET NULL` (navigation, not durability). A later import cannot change what
  was reviewed.

- **Untrusted-text law for the export (ADR-0006 layer 5 answered).** Every posting-derived or
  LLM-generated string (the `reason`, requirement text, evidence quotes) lives ONLY inside fenced code
  blocks in the rendered markdown — markdown-inert. Fence safety is deterministic (fence length =
  `max(3, longestBacktickRun+1)`, `\r` stripped, unit-tested against breakout content). Body strings
  render as-is (the user's own content).

- **Draft-until-reviewed; export manual.** `resume_variants.review_status` defaults `draft`; a
  one-shot CAS review transitions it to `reviewed`; the export route **409s a draft variant** and
  serves the stored `rendered_markdown` byte-for-byte for a reviewed one. Nothing is ever sent
  anywhere by the system.

- **Third adversarial ingress (ADR-0006 layer 6).** `resume-tailoring@v1` never sees raw posting text,
  but its structured payload carries posting-derived strings. A fictional adversarial corpus + a live
  pass (required before merge, every prompt version) covers it; the obeyed-injection surface is the
  emphasis `reason` (the model's only free-text output).

## This is Phase 1 (an emphasis guide, not a bulleted resume)

Because experience bullets are (correctly) **not** in the DB, this export is a tailoring/emphasis
**guide** over verified facts, not a formatted resume with bullets. The doc header, the UI copy, and
the BACKLOG line all say so; the output is never named or presented as a submittable bulleted resume.

**Phase 2 — the explicit additive next phase (story M2-12):** capture the real `resume.md` bullets
into a new `profile_experience_bullets` table via the importer (user-authored content — SELECTION /
REORDER of true bullets, never composition; ADR-0006 intact), add a `resume-tailoring@v2`
per-experience bullet field, extend the renderer, migration 0009 — all **additive** on M2-10, its own
plan-gate. Honesty rule for phase 2: bullets may be selected, omitted, reordered, but **the
experience always renders even with all bullets deselected** (Decision-5 extended — a job is never
hidden).

## Consequences

- Deterministic-only ordering was considered and rejected as the *whole* answer: cross-entity salience
  judgment is the Q5 dogfood value. The LLM stays, blast-radius-capped to ordering + emphasis + cited
  rationale.
- New DB schema (4 tables, migration 0008) + a new LLM prompt version ⇒ plan-gate domains; delivered
  under the M2-10 plan with the SQL walked through in the PR.
- Minted as a **new ADR, not an ADR-0006 amendment**: ADR-0006 is the injection-defense record; this
  is a distinct architectural decision (spec-not-prose) that *uses* ADR-0006's layers rather than
  changing them.

## Amendment (M2-12, 2026-07-23): bullet capture + bullet-level tailoring

Phase 2 lands as forecast above — additive on M2-10, its own plan-gate. It captures the user's own
verified `resume.md` experience bullets and lets tailoring choose which to show, without weakening the
honesty keystone (the model still emits no prose — only ordering, emphasis, and now a bullet
*selection*, all over server-assigned refs).

- **New table `profile_experience_bullets` (migration 0009, additive/forward-only).** The M0-08 importer
  now captures each experience's top-level `- ` bullets in source order; `syncProfile` mirrors them by
  `(experience_id, position)` (reword = update, shrunk tail = delete); bullets are `ON DELETE CASCADE`
  on their experience (intrinsic to the job — contrast `profile_projects`' SET NULL). Bullets are the
  user's own content, same trust class as project summaries — **SELECTION / REORDER / OMISSION of true
  bullets, never composition** (ADR-0006 intact).

- **Import guard against silent omission.** Zero bullets under an experience is a *valid* parse
  (coherence + testability — the renderer must already handle a zero-bullet experience). The safety is a
  reconciliation: a cleanly-parsed experience whose body has more bullet-shaped lines than the flat
  capture took (an indented sub-bullet, a non-hyphen marker) flags `uncaptured-bullet` — unsupported
  structure is never dropped without a trace. (Shipped with two planted-FAILs on fictional data.)

- **`resume-tailoring@v2` (new version — v1 byte-untouched, its pin unchanged).** One additive output
  field, `experienceBulletOrders`: a per-experience list `{experienceRef, bulletOrder}` over the
  payload's per-experience bullet refs `e{n}b{m}`. New pin line; the registry hash test enforces both
  the new pin and v1's immutability.

- **The one genuinely new decision — entity permutation vs. bullet subset.** `skillOrder`/`projectOrder`
  stay exact permutations (reorder-only, never drop: omitting a whole skill/project misrepresents
  breadth). A `bulletOrder` is a **SUBSET** — select / reorder / **omit** — because trimming bullets per
  posting is honest tailoring. This is safe *only because the parent experience always renders*: there
  is no field, in the spec or the renderer, that removes an experience line (the Decision-5 invariant,
  now extended to "a job is never hidden even with every bullet deselected"). `validateTailoringSpec`
  enforces membership + the `e{n}b…` ownership prefix (a cross-experience or unsent bullet ref is a
  fabrication that flags the run); omission never counts as a missing ref. Shape constraints
  (unique `bulletOrder`, one block per experience) live in the v2 zod schema, as `skillOrder`
  uniqueness does.

- **Renderer + fail-safe default.** The renderer emits the selected bullets as an indented sub-list
  under the always-present experience line (user content, rendered as-is — same trust class as
  `label`/`detail`, not fenced; a `\r?\n` inside a bullet is collapsed to a space so it can't break the
  sub-list — a render-integrity guard, not escaping). Emphasis marker numbering is emphasis-only, so
  bullets never consume `[n]` markers. An experience the model names **no** block for renders **all** of
  its bullets in source order — a spec gap defaults toward completeness, never toward silent total
  omission.

- **Export-only scope (this phase).** Tailored bullets flow into the frozen `rendered_markdown`
  snapshot (the durable, reviewed, exported artifact); the GET `/profile` and variant wire schemas strip
  them, so the web structured preview is unchanged. Consequence: no structured per-variant record of
  which bullets showed — acceptable for phase 2; a future analytics story re-opens a variant-side bullet
  table.

- **Third-ingress live pass refreshed.** A new prompt version requires a fresh live adversarial pass; the
  tailoring corpus now runs against `resume-tailoring@v2` (the experience carries a bullet so the live
  pass exercises the selection path; bullet fields carry only refs, adding no free-text injection
  surface — the obeyed-injection surface stays the emphasis `reason`).

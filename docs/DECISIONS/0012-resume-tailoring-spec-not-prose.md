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

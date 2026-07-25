# ADR-0014: Skill level ownership — declared / earned / effective

**Status:** Accepted · **Date:** 2026-07-25

## Context

M3-06 (Evidence → profile upgrades) closes the M3 Skill Accelerator arc: a completed exercise with
full mastery evidence should be able to **earn** a `profile_skills` level upgrade — suggested
deterministically, applied only on Carlos's explicit confirmation, with a preserved audit trail of
which evidence justified which upgrade. This is the flywheel edge already drawn in the ERD
(`mastery_evidence → profile_skills.level upgrades`).

The story was deliberately gated on **four parked design constraints** from the M0-08 importer review
(BACKLOG M3-06). The tension they name: the markdown importer (`syncProfile`) owns `profile_skills`
today as a **full mirror** — it upserts by `lower(name)` and **deletes every skill absent from
skills.md**, on the ratified contract "markdown is the single source of truth; identical re-import =
all-zero counts." An upgrade earned from evidence has **no markdown home**, so a naive write to
`profile_skills.level` would be silently reverted by the next re-import, and cascade-deleting a renamed
skill would orphan its audit trail.

Unlike M3-03/M3-05 (schema-only stories where the professor correctly struck an ADR because the pattern
was structurally identical to shipped precedent), this decision **formally narrows a ratified
contract** — "markdown is the single source of truth" becomes "markdown is the single source of truth
*for the declared level*; the effective level is a computed view" — and resolves four named parks
spanning two subsystems (importer + fit engine). That is a "new major technical choice" per CLAUDE.md,
hence a new ADR rather than an amendment.

Pre-registered posture, confirmed at sizing: **deterministic suggest-and-confirm, schema + service, NO
LLM surface** (no prompt, no corpus, no live pass) — the ADR-0013-family precedent class.

## Decision

**Ownership split — table-plus-projection (resolves parks 1 + 2).**

- **DECLARED** level = the `profile_skills.level` column, owned by the markdown importer, **untouched
  byte-for-byte** by this story.
- **EARNED** level = an active row in a new `skill_upgrades` table (`to_level`, always `solid` — see
  below).
- **EFFECTIVE** level = `maxSkillLevel(declared, …active earned)`, **computed at `getProfile`** (the
  single profile-read choke point) and **never stored**.

`max` (not "earned overrides") is load-bearing: a later declared promotion in skills.md (e.g. to
`expert`) must not be capped by an older `solid` grant — a grant can only ever **raise** the level,
never suppress it.

The three-column split on `profile_skills` (declared/earned/effective columns) was **rejected**: it
does not remove the audit tables (the AC requires grant + evidence rows regardless), and it forces
`syncProfile`'s update/delete legs to become split-aware — re-proving the ratified all-zero-counts
idempotency contract. Direct-write + grant-aware sync was **rejected** for the same reason (writers
entangled: every re-import would have to consult grants inside the import transaction). The
table-plus-projection keeps the importer oblivious to grants — which is exactly why a re-import **cannot
revert** an earned upgrade (park 2, resolved structurally): the importer never reads or writes
`skill_upgrades`. Honest cost: the effective level is a computed fact; any future reader of raw
`profile_skills` rows that bypasses `getProfile` silently sees declared-only (today the only such reader
is `syncProfile`, which is the point). A schema doc-comment on `skill_upgrades` directs future readers
through `getProfile`.

**Shared normalization (resolves park 3).** A single core helper `skillNameKey(name) = name.toLowerCase()`
— **exactly** the `profile_skills` unique-index expression `lower(name)`, deliberately **not**
`trim+lower` (which would mint a third normalization that collides where the DB index does not; the
parser already trims cells upstream). The importer's three skill dedup sites were refactored to call it,
and the upgrade writer derives its key from an existing stored (already-trimmed) skill row — so
parser-writer and upgrade-writer provably share one normalization. With this design the feared "second
writer to `profile_skills`" **never materializes**: the new writer writes only its own tables. (The
M0-08b "also enforce normalization in-DB?" question stays parked, unchanged.)

**Append-only grants with revoke (resolves park 4).** `skill_upgrades.status ∈ {active, revoked}`. A
grant is **never deleted**; `POST /skill-upgrades/:id/revoke` flips status + stamps `revoked_at`
(+optional note). After a revoke the effective level falls back to declared; re-earning is allowed
(the unique index is scoped `WHERE status = 'active'`). Downgrading the **declared** level stays
Carlos-owned: edit skills.md + re-import (the importer's existing overwrite is now the *feature* on that
leg). Net correction story: wrong earned level → revoke; stale declared level → markdown.

**Suggestion policy.**

- **Suggestion-eligible exercise (OD-3):** ≥1 `implemented` AND ≥1 `tested` AND ≥1 `explained` — all
  three **acquisition** kinds. `revisited` (M3-05's *retention* axis) is excluded: it is only recordable
  ≥7 days post-completion and would time-lock every upgrade. Consequence, accepted not fixed:
  `explained` is freely deletable (the M3-03 D2 guard protects only `implemented`/`tested`), so a
  suggestion can disappear and reappear as `explained` rows change; the confirm re-derives at POST time
  and the grant snapshots freeze the as-of-grant trail.
- **Target level (OD-4): always `solid`; `expert` is never suggestible** (markdown-declared only). Two
  reasons for the record: (a) the ladder is not linear — `rusty` means *past competence gone stale*, and
  an exercise cannot make you stale, so `learning → rusty` is semantically void; `solid` is the only
  coherent earned target from either suggestible start. (b) `expert` would be pure inflation with zero
  engine effect — the fit engine maps `expert` and `solid` identically to evidence strength `direct`
  (`prepare.ts`), so `solid` already buys everything the engine can pay out, and `expert` is the one
  level exercise evidence cannot falsify.
- **No row creation, ever.** Suggestions and grants exist only for skills already in the profile; a new
  skill enters via skills.md (a row the importer did not create would be deleted by the next full-sync
  anyway).
- **Evidence freshness (OD-6): none** (timeless re-derivation), explicitly accepted. A skill declared
  `rusty` today will immediately re-suggest from a months-old exercise; the confirmation gate is the
  filter (Carlos sees `completedOn` and simply doesn't confirm). A recency bound is a policy knob an S
  story should not mint — parked as **M3-06a** (BACKLOG Icebox), trigger = dogfood evidence of stale
  suggestions actually misleading.

**Server-anchored confirm.** `POST /skill-upgrades {profileSkillId, exerciseId}` re-derives the whole
suggestion server-side (the M3-04 zero-client-trust precedent) before persisting: 404 for a
missing/foreign skill or exercise (checked before), then 409 `UPGRADE_NOT_DERIVABLE` (exercise not
complete, evidence not full, no phrase match, or effective already ≥ `solid`). The one-active-grant
invariant has a DB backstop — a partial unique index `(user_id, skill_name_key) WHERE status = 'active'`
— whose 23505 maps to 409 `UPGRADE_ALREADY_ACTIVE`. That path is **race-only**: once a grant is active
the overlay makes the skill effective-`solid`, so a sequential repeat POST is `UPGRADE_NOT_DERIVABLE`;
the index only catches two in-flight confirms.

## Consequences — named residuals and second-order effects

- **(a) Wire visibility (OD-7).** `GET /profile` serves the **effective** level as `level` (all five
  consumers stay one code path) **plus** an additive, always-present `declaredLevel` — silent elevation
  on an export-feeding surface would be a debugging and honesty trap. Realized as a **separate**
  `profileSkillWithDeclaredSchema` for the GET /profile wire, kept distinct from the base
  `profileSkillSchema` the fit engine consumes: the engine's parse strips `declaredLevel`, so the
  deterministic scoring engine reads effective-only and is provably unaffected (pinned by a strip test).
  (This realizes OD-7's stated scoring-invariance; editing the shared schema in place would have forced
  `declaredLevel` into every scoring/api fixture — recorded as an implementer's structural choice.)
- **(b) Fit-classification ripple — the point of the story.** A level upgrade changes fit
  classification: `prepare.ts` maps `expert|solid → direct`, `rusty|learning → partial`, and
  `classify-gaps` splits partials into `needs_refresh` vs `learning` buckets. An earned `solid`
  therefore strengthens a skill's evidence links and can move a gap out of the refresh bucket — the
  intended flywheel edge.
- **(c) Interview-prep second-order effect.** A gap-disclosure obligation (M3-04 tripwire) can disappear
  for a skill the user has upgraded — correct if the grant is honest, but a behavior change in a fourth
  module, recorded here so it is not surprising later.
- **(d) Deliberate NON-snapshot of requirement/gap text (privacy-coherence).** The `skill_upgrade_evidence`
  trail snapshots kind / artifact_url / recorded_on and the grant snapshots skill name + exercise title;
  it deliberately **does not** snapshot requirement or gap text. Posting-derived text must not outlive a
  posting hard-delete (`requirements` cascade with postings by design); the why-it-matched context is
  recomputable while the posting lives and gone after purge — a named residual, not a leak.
- **(e) Rename-detach residual (OD-8).** A markdown rename (`TypeScript → TS`) is delete+insert under
  full-sync, so neither `profile_skill_id` (SET NULL) nor `skill_name_key` survives — the grant
  **detaches** and effective for the new name reverts to declared. Accepted (the alternatives are a
  grant-aware importer or a durable identity full-sync's delete+insert cannot provide), consistent with
  the matcher's recorded "alias matching deliberately absent" limitation. Required mitigation shipped:
  `GET /skill-upgrades` derives `detached: true` for any active grant whose `skill_name_key` matches no
  current skill — read-time, no schema/write/importer change — turning "re-import silently reverts" into
  "re-import visibly detaches; revoke or re-earn."

## Alternatives considered

- **Three columns on `profile_skills`** — rejected (does not remove the audit tables; entangles the
  importer's idempotency contract).
- **Direct write + grant-aware sync** — rejected (every re-import must overwrite — the exact "silently
  revert" park 2 names — or consult grants inside the import transaction).
- **`trim+lower` normalization key** — rejected (a third normalization that collides where the
  `lower(name)` index does not).
- **Suggesting `expert`** — rejected (pure inflation, zero engine effect, unfalsifiable by evidence).

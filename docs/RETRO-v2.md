# CareerForge v2 - retrospective

**Status:** written at v2 close, 2026-08-14 (M11-03) - **Ledger basis:** `MERGE-LOG` and its
2026-07 / 2026-08 archive tranches, 125 merge records spanning PR #74 to PR #202.

## How this document was written

Every claim below cites a merge record, a `docs/BACKLOG.md` build record, or an ADR, and was
authored **after** the outcome existed - never from an expected result (CLAUDE.md, evidence-before-claims).
A reviewer should be able to check any sentence against a named record without asking the author
what they meant. Counts were re-derived firsthand at close from the ledger and the backlog rather
than inherited from the story plan, which pinned its own numbers at main `d810e3c` and said plainly
that they would be stale by the time this ran. They were: the plan recorded M14 as having zero
backlog rows, and M14 carries seven at close.

Where this retro says something went wrong, it names the record that proves it. A retro that reads
as a victory lap is worth nothing to the person reading it next year.

## What v2 delivered

Counted from the ledger at close: **78 distinct stories shipped** across M5 through M15, against
**133 distinct story rows** in the backlog (the remainder are planned, parked, or operator-attested
work that has not shipped). The arc's visible outcomes:

- **A public demo.** M10-01..08 put the product on the internet at `demo.carlosgutz.com` - AWS ECS
  Fargate, Neon Postgres, Terraform, OIDC-only CI deploy with immutable image tags, at roughly
  $13/month under a $20 guardrail (BACKLOG M10 milestone-close record, 2026-08-03; ADR-0022,
  ADR-0023). The demo is keyless and fail-closed by construction: in `DEMO_MODE` a present key
  refuses to boot.
- **A correctness arc.** M12-02..04 replaced "absence of evidence is a confirmed gap" with a
  category-aware classifier, growing the gap vocabulary from five classes to eight and adding a
  durable-facts evaluator (BACKLOG M12-02 and M12-03 build records; ADR-0020, ADR-0021).
- **A hardening arc.** M13 shipped eleven of its thirteen rows from a security exam, including a fail-closed
  Origin check that removed a non-browser carve-out (RISKS S-04, M13-06) and an advisory sweep that
  took 13 high findings to zero (MERGE-LOG PR#164).
- **A provenance arc.** M15 made the resume-integrity gate say *which* law fired rather than only
  that something did, stopped unhandled errors leaking query text and bound parameters (PR#190),
  and stopped a dev boot proceeding against a drifted database (PR#191).
- **A design system and a case study.** M8 shipped 24 of its 25 rows (M8-23 remains open) through to
  a self-hosted-font, a11y-clean portfolio, and M11-02 rewrote the case study on merged-and-sealed
  work only (PR#200).

## The reconciliation (M11-03 leg (a))

Every shipped story was mapped from the ledger to its backlog row and compared. **The result is a
no-op: zero rows were missing and zero statuses were stale**, so this story adds no rows. That is
the finding, not an absence of one - the mandate that opened this work assumed v2 stories had
"almost no rows on main", the story plan had already corrected that to a much smaller gap, and the
gap at close is empty.

Two candidates surfaced and both were rejected by reading the evidence rather than by pattern:
**M9-01** carries PRs in the ledger but its completion is an operator attestation the row itself
forbids Claude to fabricate, and **M11-02** stays `planned` deliberately because its screenshots leg
was named as undelivered in its own build record. Flipping either would have written a false
sentence into the project's own ledger, which is the single real hazard this story was scoped
around.

One genuine discrepancy is recorded rather than fixed: **PR #123 and #124 are labelled `M9-01` in
`MERGE-LOG` and cited as `M12-01`'s delivery in `BACKLOG.md`.** Both point at the same commits
(`4982f1d`, `c284bee`); the ledger names the milestone whose finding the work discharged, the
backlog names the story that owns the row. Neither is wrong, and reconciling the vocabulary is not
this story's call to make.

## What went wrong

This is the section worth keeping.

**The instruments lied more often than the code did.** Four separate times a check reported clean
or correct when it was neither, and each was caught by a second look rather than by the check
itself:

- A privacy scan reported 339 findings, then 24, then 7, then 4 - every drop a fix to the
  instrument (missing distinctiveness subtraction, then case sensitivity, then substring matching
  where word boundaries were needed), not to the data. The residual four were ordinary English
  words. The lesson was written into the protocol as law: a privacy count is not a finding until
  distinctiveness, case normalization, and word boundaries are all applied, and the method is
  stated with the number.
- The host's `grep` is `ugrep`, which errors on a NUL inside a bracket expression while *looking*
  clean - so a NUL scan that appeared to pass had not run. A raw NUL byte reached a committed
  source file through exactly this blind spot and was caught only by a direct `perl` scan
  (BACKLOG M12-03 build record). Every NUL/C0 scan since carries a positive control that must fire.
- A control run in M15-05 was invalid because its label did not match the harness's exact-match
  filter, so it tested the reachable database instead of the unreachable one. It was caught because
  a boot that should have failed printed `Server listening` (BACKLOG M15-05 build record).
- Writing this retro, the reconciliation instrument itself produced a wrong answer: `comm` was fed
  version-sorted input when it requires lexical sort, and reported nonsense. The corrected run was
  then proved honest by removing a known row and confirming the tool reported it missing.

**Merging is a claim about a commit, not about a pull request.** The CAS discipline
(`--match-head-commit` with the full 40-character SHA) exists because a PR's head can move between
"checks green" and "merge". It earned itself twice more in this arc: PR#190's first merge attempt
was refused when the branch had drifted against a post-#191 main, forcing a rebase and a re-glance
before it could land; and PR#178 proved that identifying a merge commit by parent *count* is
unsound, so seals since identify merges by subject.

**A short SHA cannot be padded into a long one.** On 2026-08-14 a merge record was published with a
40-character SHA extrapolated from the short form before verifying. The fabricated SHA shared the
first seven characters with the real one and resolved to no object at all. Self-caught within
thirty seconds and corrected in place; the corrected record stands. It is in this retro because the
failure mode is invisible by inspection - a plausible-looking SHA is indistinguishable from a real
one without `git rev-parse`.

**Planning was a single point of failure.** Story m14-02 sat stranded for six days waiting on a
disposition that no one was assigned to make. The rule that came out of it is narrow and worth
keeping: a lane executes an `approved.md` only, never a draft, only with a GO in its inbox, and it
verifies the plan's content hash *and* fires a difference control before starting.

**Two accounts of the same failure were both partly wrong.** The chromium-bake investigation had
two competing explanations for why a host was unreachable; measurement showed the truth was both
of them at once - the allowlisted host answers from rotating addresses so a pinned IP goes stale,
*and* a fallback host was never listed. Either alone would have broken it, so the obvious fix
(adding hosts) could never have worked (MERGE-LOG PR#195).

**A quality floor was not met, and saying so was the right call.** M8-22 shipped with the M2-09
"100 across four categories" bar unmet at both refs. Rather than restate the bar as passed, the
merge record states plainly that it was not met, records a re-scoped bar that *was* met
(no regression, zero new axe violations, CLS 0), and names the follow-up stories that are the real
remedy (MERGE-LOG PR#192). A related case: M11-02's case-study rewrite found its own published
prose asserting "only the portfolio is deployed publicly" in three places while the article's first
line pointed at the live demo, and corrected all three rather than the one that was noticed first
(BACKLOG M11-02 build record).

**A security boundary turned out to be a policy.** A lane demonstrated that `git push` worked from
inside a seat container, falsifying a claim the lane had already written into its own README:
merges happening on the host was policy, not a wall. That opened M14-07. Days later the opposite
became true for an unrelated reason - a credential-shim socket died when the fleet changed its boot
path - and the accidental state (containers with zero push capability) was accepted as the more
secure posture for the rest of the wave, with the durable fix designed as a narrowed, repo-scoped
proxy rather than a restoration of the old unscoped channel. The honest reading is that neither the
original claim nor its correction was ever verified by design; both were discovered.

## What the arc changed about how work gets done

- **Evidence before claims**, enforced at the artifact level: outcome-describing text is authored
  after the outcome exists. Several build records in `BACKLOG.md` are explicit that a status moved
  to `done` on code-complete and that the seal line was written separately, post-merge.
- **Gate changes ship a demonstrated detection.** Any modification to a verification gate carries a
  planted-FAIL recipe that a second party can re-run - generated from `git`, never hand-written,
  and regenerated when formatting moves line numbers.
- **Review before the merge word for anything executable.** Content that runs, or governs what
  runs, is reviewed before merge rather than retroactively; pure-append prose may merge
  post-checks.
- **Findings end in one of three states** - written into a doc, parked with a named story, or
  dismissed with a stated reason - never left only in a chat transcript.

## What is not done

The backlog is reconciled and honest, which means it still contains work. Nothing below is being
closed by this document.

- **M9-01 and M11-01** are operator dogfood stories. M11-01 was attested by Carlos on 2026-08-13;
  its row flip is owed and tracked separately. M9-01's row remains `planned` and stays that way
  here: the story's own text says Claude assists and does not fabricate the attestation.
- **M11-02 remains `planned` deliberately** - the post-redesign product screenshots leg was named
  and not delivered, which its build record states rather than hides.
- **M8-23** (the shipped "woff2" is a raw TTF), **M13-05** (keyed-mode LLM budget, parked under the
  standing no-paid-calls law in RISKS T-04), **M13-13** (TypeScript 6 bridge), and
  **M14-05..M14-08** (egress allowlist leg (a), unowned in-container test failures, the push-channel
  proxy, the playwright pin guard) are all open with named triggers.

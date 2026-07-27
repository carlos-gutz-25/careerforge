# ADR-0017: External-recommendation honesty (no-URL law)

**Status:** Accepted · **Date:** 2026-07-26

## Context

M7 (Coaching, v2) extends improvement plans (M1-12) with TYPED recommendations: alongside the
free-text `action` on a plan item, the model may suggest concrete next steps - a resource to study, a
certification to pursue, a demo project to build, a practice drill. M7-01 is the foundation story;
M7-01a (this change) authors this ADR, the closed core vocabularies, and the deterministic
`containsExternalPointer` guard, with NO migration yet. The `plan_item_recommendations` table is
M7-01b, deferred behind lane A1's open migration slot per the single-open-migration rule.

The honesty hazard here is specific and different from the existing citation tripwire (ADR-0006 layer
4, which checks that the model only cited a gap ref that was actually sent it). A recommendation names
EXTERNAL things - a course, a cert, a tool. The failure mode is the model emitting a URL, email, or
domain: an unverifiable pointer. The model cannot know a link is live, correct, current, or safe, and
a drafted link is also the "send the user off-platform / resemble an application" surface the product
forbids (RISKS H-01: everything LLM-drafted is draft-until-reviewed, and nothing resembling an
application is ever sent by the system). Training-data URLs are stale or hallucinated by construction.

This is a **new ADR, not an amendment** (the ADR-0010/0012/0013 "mint new, don't amend" reasoning): it
adds a law and an enforcement primitive; it changes no existing layer.

## Decision

- **The no-URL law.** A recommendation carries NO external pointer. A URL, a `www.` host, an email
  address, a contact scheme (`mailto:`/`tel:`), or a bare domain emitted anywhere in a recommendation
  is an unverifiable citation and is FORBIDDEN. Enforcement is deterministic and server-side:
  `containsExternalPointer` (packages/core, pure, browser-safe) is the tripwire, and when it fires on
  any drafted recommendation the whole run is **flagged and NOTHING is written** - the
  flag-the-run-write-nothing discipline shared with every drafting family. The model is instructed to
  name resources in words ("the official TypeScript handbook", "a Kubernetes fundamentals course"); the
  USER finds and verifies the link.

- **Dotted tech names are not pointers (test-pinned).** The guard's one real false-positive class is
  technology names that look domain-shaped. The `.js` family (`Node.js`, `React.js`, ...) is safe for
  free because `js` is not a TLD. Two names that DO end in a real TLD, `socket.io` and `asp.net`, are
  pinned out explicitly in a negatives set. The pinned set and the recognized-TLD set are both
  test-locked; widening either is a one-line change with a test row. The guard is deliberately
  conservative: an unpinned product name ending in a public TLD over-flags to human review rather than
  passing silently.

- **The suggestion lifecycle is a closed vocabulary.** `kind in {resource, certification, demo_project,
  practice}` and `status in {suggested, adopted, dismissed}` (core consts + zod enums, this change).
  A recommendation is born `suggested`. `adopted` is the USER'S OWN attestation - "I did this" - never
  the model's claim and never auto-set; this is the honesty keystone (the system never asserts an
  accomplishment the user did not confirm). `dismissed` is the honest "not for me", never a silent
  deletion (the PLAN_ITEM_STATUSES `dropped` precedent). The parent plan's draft-until-reviewed gate
  still governs everything.

- **Certification framing.** A certification is recommended ONLY when posting evidence shows it beats
  the alternative use of the same time - i.e. the real postings the user is chasing actually ask for
  it. The product never recommends a paid credential on general principle.

- **UI honesty copy (contract for M7-04).** Recommendations render with a standing disclosure: "model
  suggestions from training data - verify currency yourself." The copy is honesty-load-bearing and will
  be pinned by a test when the UI (lane B2) lands.

## Alternatives Considered

- **Allow URLs, validate them at draft time (HTTP liveness check).** Rejected: it puts the platform in
  the business of fetching arbitrary model-emitted URLs (an SSRF and privacy surface), still cannot
  judge whether a live page is the RIGHT or a safe resource, and contradicts local-first + never-send.
  Naming resources in words and letting the user verify is both safer and more honest.

- **Allow URLs but mark them "unverified".** Rejected: an unverified link is still a click off-platform
  and still reads as the system pointing the user somewhere; the label does not remove the hazard. The
  no-URL law is a bright line, which is exactly what makes it deterministically enforceable.

- **A model self-report field ("I am confident this link is current").** Rejected outright: model
  confidence about external state is precisely the fabrication the product exists to refuse.

- **A dot-only heuristic (flag any token containing a dot).** Rejected: it floods on `Node.js`,
  `v2.0.1`, `e.g.`, and filenames. A TLD-anchored probe plus a pinned tech-name negatives set is the
  smallest rule that catches real pointers while leaving ordinary coaching prose alone, and every
  negative is test-pinned so the boundary cannot silently drift.

## Consequences

- **No schema in this change.** M7-01a ships the ADR + the core vocabularies + the guard + tests only.
  The `plan_item_recommendations` table is M7-01b (migration), and the v2 drafting plus the pointer
  tripwire's planted-FAIL detection proof are M7-03 - sequenced after lane A1's M6-04 migration
  releases the single migration slot. The guard is therefore born with unit tests but no runtime caller
  until M7-03. This is deliberate: the law and its enforcement primitive are settled before any table
  or prompt depends on them.

- **The guard is a shared primitive.** `containsExternalPointer` lives in packages/core beside the
  other pure text guards; the application-gameplan family (M7-05+) reuses it, and its sibling
  `looksLikeOutreach` (message-likeness) is authored there under the gameplan ADR. Keeping
  pointer-detection and outreach-detection as distinct named guards follows the `normalizeWhitespace`
  vs `normalizeForMatching` precedent: one contract per job, never overload one function.

- **Named residual (a flag means review, not loss).** A genuine dotted product name ending in an
  unpinned public TLD will flag until it is pinned. This is a conservative over-flag by design; the fix
  is always to pin the name (one line + a test), never to loosen the TLD set. Stated plainly so a
  future maintainer does not "fix" it by weakening the guard.

- **Numbering.** v2 ADR numbers are assigned at merge order against `origin/main` (PLAN 7.3, V2-PLAN
  §6). **0016** went to the design-system ADR (M8-01, PR #76), which merged first; this ADR is therefore
  **0017**, verified lowest-free against `origin/main` at push time. The short-lived ADR-CLAIMS.md claims
  ledger was retired by operator ruling in favor of the origin/main-is-truth mechanism. The reserved
  `RESERVED-<slug>.md` stub is discharged by this rename.

## Value

- **Product:** coaching recommendations the user can trust precisely because the system never pretends
  to know a link is good - it names the resource in words and hands verification to the person, which
  is both safer and more useful than a wall of stale or hallucinated URLs.
- **Skills:** demonstrates a deterministic honesty guard with a test-pinned false-positive boundary, a
  closed lifecycle vocabulary with user-only attestation, and the discipline of settling a law and its
  enforcement primitive before any schema or prompt depends on them.
- **Employability:** the same honesty-first differentiator that runs through the fit, resume, and
  interview-prep surfaces, extended to coaching - the product refuses to fabricate an external pointer
  or to claim an accomplishment the user did not attest, and it enforces that in code, not just prose.

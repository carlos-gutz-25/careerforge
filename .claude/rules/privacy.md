---
paths: ["docs/profile/**", "docs/profile.example/**", "scripts/privacy-check.mjs", "apps/portfolio/**"]
---

# Privacy gate — full semantics

The public-repo privacy boundary is in CLAUDE.md. This file is the complete
documentation of the P-01 content leg and when to run it.

## When to run
On any branch that touched profile-adjacent code: run
`node scripts/privacy-check.mjs` AFTER the final commit, BEFORE pushing. It
reads the committed branch diff only; uncommitted changes are invisible to it.
CI's privacy legs are structural only (gitleaks + tracked-file guard); the
content comparison can only happen locally where the real profile exists.

## What privacy-check.mjs does
It derives tokens from the real `docs/profile/` at runtime (incl. phone/salary
probes matched in normalized form, and since M6-01 a contact-block extractor
that probes the plain non-link/non-blockquote lines of resume.md's contact
region — the home-address-adjacent location line above all, which the structural
heading/bold/table-cell extractors miss — in a whitespace-collapsed normalized
form that never consults the publication allowlist, since location is a
sensitive class; and since M12-03 a facts extractor that probes the free-text
value/note fields of facts.md whole-string in that same normalized,
allowlist-never-consulting form, facts being a sensitive class too) and greps
them against the lines the COMMITTED branch diff ADDS
(`git diff <origin-default-branch>...HEAD`, added lines only — deleted/context
lines are already-public base content; main fallback; pnpm-lock.yaml lines
excluded since M0-10 — registry-derived public identifiers kept colliding with
short real-skill cells, and private data cannot enter a lockfile through
dependency resolution; since M1-01, tokens already occurring in the base
branch's committed content are subtracted as public vocabulary —
distinctiveness-based matching per the resolved M1-01 park, closing the
common-English-word false-positive class). It prints masked tokens + counts
only, never values.

## Reading the result
Exit 0 = clean, 1 = leak found, 2 = cannot run (no docs/profile/ — CI/fresh
clones; never reported as a pass).

## Measurement discipline
A privacy count is not a finding until distinctiveness subtraction, case
normalization, and word boundaries are all applied — state the method with the
number (ops-board rider, 2026-08-06). PR bodies are a publication surface the
gate does not cover — see `.claude/rules/verification.md`.

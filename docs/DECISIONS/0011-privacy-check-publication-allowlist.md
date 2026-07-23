# ADR-0011: Privacy-check publication allowlist for deliberately-published case-study tokens

**Status:** Accepted · **Date:** 2026-07-22

## Context

M2-04 shipped the case-study *mechanism* (schema, validator, template) with zero content. M2-05
publishes the first case-study *content* — three Heartland studies — into the public repo
(`apps/portfolio/content/case-studies/*.md`). That content is authored **from** the private,
gitignored `docs/profile/projects.md`, so by construction it reproduces some strings that, today,
exist only in the private profile.

`scripts/privacy-check.mjs` (the P-01 content leg) extracts **structural** tokens from `docs/profile/`
(bold spans, headings, first table cells, plus email/URL/phone/salary probes) and fails (exit 1) on
any that appear in the branch's added lines and are not already public vocabulary (base-tree +
`profile.example` subtraction). It is a per-branch gate that assumes profile strings should never
cross into the tree — but M2-05/06/07's whole purpose is to deliberately cross a **sensitivity-reviewed
subset** (RISKS L-02 / OPEN-QUESTIONS Q7). The gate cannot distinguish a reviewed, intentional
publication from an accidental leak, so the first publishing branch trips it.

**Empirical collision set (privacy-check's own extract + subtract over the drafted studies), not an
expected list:** exactly `heartland payment systems`, `azure devops`, `terraform`. Everything else the
studies name — `Snowflake`, `Redis`, `Pinia`, `Vue.js 3`, the metrics — was already public vocabulary
(the BACKLOG story text alone, "Redis/Snowflake caching", seeds the base-tree subtraction corpus), so
it does not flag. The real crossing is three tokens: an employer name already on the public
resume/LinkedIn, and two public infrastructure tools.

## Decision

Add a small, explicit, operator-cleared **`PUBLISHED` allowlist** to `privacy-check.mjs`, applied
**only in the structural-token pass**. It clears exactly the tokens that (a) empirically collided and
(b) the operator sensitivity-reviewed for publication.

- **Sensitive classes are never allowlisted.** Contact info (email/URL/phone), salary, and home
  address stay fully detected. The phone/salary normalized probes do not consult the set at all, and no
  entry of those classes is ever added. The allowlist is scoped to deliberately-published
  professional-identity strings (employer, public tech stack) — nothing else.
- **The allowlist is empirical and minimal.** Entries are the tokens that actually collided, ratified
  per token by the operator, each with an inline justification. Already-public vocabulary is *not*
  added — the base-tree subtraction already clears it, and a smaller `PUBLISHED` set is a smaller
  trusted surface. This ADR and RISKS describe what **empirically collided**, never an expected list
  (evidence-before-claims binds the ADR text too).
- **The demonstrated detection is a committed, CI-run test, on fictional data.** The gate law requires
  a proven FAIL on planted fictional data in the same change. `scripts/privacy-check.test.mjs` (a new
  `scripts` vitest project) drives the real CLI against a scratch repo and proves the allowlist is
  **token-scoped, not file-scoped**: an allowlisted token passes while a distinctive token *and* a
  fictional phone in the *same* added file still fail (exit 1). Planting fictional data means no real
  sensitive value ever enters branch history — which an on-branch CLI plant (privacy-check only fires on
  *real* profile tokens) could not achieve.
- **Bridge, not a hole.** Once the studies are committed, their tokens are part of the public base tree
  and are subtracted automatically on every later branch. The allowlist exists to get the
  **first-publish push** past the gate; it is not an ongoing suppression.

## Alternatives Considered

- **Exclude `content/case-studies/**` from the scan** (as `pnpm-lock.yaml` is excluded) — rejected. It
  removes leak detection inside exactly the authored prose most likely to leak (a phone number or salary
  figure typed into a study would sail through), and it cannot satisfy the gate law, which requires a
  demonstrated **detection** — the opposite of removing one.
- **Author around the tokens** — rejected. Impossible for public tech names (a Snowflake/Redis case
  study must name Snowflake/Redis) and dishonest for the employer name Carlos has cleared to publish.
- **One broad "professional-identity" class the gate trusts** — rejected as over-trust; explicit
  per-token entries keep the cleared set auditable and minimal.

## Consequences

- **Future content stories (M2-06/07) enumerate their own collisions** via privacy-check's extract +
  subtract and add **only** what actually collides — never a padded list. The employer/metric clearance
  is the operator's per-story call (L-02).
- **The sensitive-class guarantee is unchanged and testable.** A regression that let the allowlist clear
  a phone/salary/email would fail `privacy-check.test.mjs` in the `test` job.
- **Two legs still hold.** privacy-check remains the local content leg (run after commit, before push);
  CI's structural legs (gitleaks + tracked-file guard) are unchanged. The allowlist changes only which
  *distinctive structural* tokens are treated as public — the deliberately-published ones.

## Value

- **Product:** the portfolio can publish real, substantiated professional case studies without
  weakening the privacy gate that protects the genuinely sensitive data behind them.
- **Skills:** a privacy gate that models the difference between an accidental leak and a reviewed,
  auditable publication — token-scoped, empirically derived, and regression-tested.
- **Employability:** the public repo shows deliberate handling of the private/public boundary — the
  crossing is explicit, minimal, operator-ratified, and proven to still catch what it must.

## Amendment — M2-07 (2026-07-22): publication-staging structural-source exclusion

**Context.** M2-07 is the first case study published *from* `docs/profile/case-studies-draft.md`
(the CareerForge draft) rather than from `projects.md`. Because privacy-check extracts structural
tokens (bold spans, `#`–`###` headings, first table cells) from **every** `docs/profile/*.md`, and
the published `careerforge.md` reuses its own approved draft's headings and bold lead-ins verbatim,
the first enumeration flagged 20 collisions — all of them the draft's own section titles and bold
leads (for example "primary user", "park work honestly", "every gate must be observed failing").
None were sensitive data; they were the deliberately-published content colliding with its private
staging file.

**Decision.** A **publication-staging draft** is content authored FOR the public tree, so its
structural tokens are not private. `privacy-check.mjs` now excludes `case-studies-draft.md` (a named
`STAGING_DRAFTS` predicate) from the **three structural extractors only** — bold spans, headings, and
first-table-cells. The **sensitive-class scans still run over it**: email and URL (the same extractor
loop) plus phone and salary (their own normalized probes). A real email, URL, phone, or salary typed
into the draft therefore still fails. This is a **source exclusion, not an allowlist addition** —
`PUBLISHED` is unchanged (still exactly the six M2-05/M2-06 tokens); it adds zero tokens.

**Demonstrated detection (gate law — two planted-FAILs on fictional data, red-then-green).**
`scripts/privacy-check.test.mjs` drives the real CLI against a scratch repo and proves: (a) bold and
heading tokens from a real, non-draft profile file still leak (the exclusion is scoped, not global);
and (b) the draft's structural tokens are cleared while its fictional email, URL, phone, AND salary
each still fail. The email and URL legs are exactly what a naive whole-file `continue` would drop;
both red states were observed before the fix (no exclusion → the draft structural token leaks;
whole-file skip → email/URL stop firing) and go green with the scoped predicate.

**Residual, named honestly.** A sensitive string that is (i) NOT an email, URL, phone, or salary AND
(ii) appears only as a bold span / heading / table cell in the staging draft (in no real profile
file) now relies on the **Pause-1 honesty gate** rather than privacy-check's structural leg. This is
acceptable because a staging draft is authored from real profile files and the honesty gate verifies
every published claim against its source before merge. The bridge property is unchanged: once the
study is committed, its strings are public base vocabulary and are subtracted on every later branch.

## Amendment (M2-08, 2026-07-22): identity allowlist adds + a narrow URL carve-out

**Context.** M2-08 published the home/about/resume pages — the first non-case-study profile content
in the public tree, sourced from `docs/profile/resume.md` and the job-criteria positioning statement.
Enumeration over the committed pages (privacy-check's own extract+subtract, authoritative) surfaced
five collisions: four non-sensitive identity tokens and one URL.

**Decision — structural allowlist (four tokens).** Added to `PUBLISHED`, each empirically collided,
each non-sensitive and operator-cleared per token: `love's travel stops & country stores` and
`nintendo of america` (past employers), `automation software engineer` (past job title), and
`university of washington` (education). Employer/title/school strings cannot be rephrased away without
falsifying the record, so they collide until they land in the public tree. A colliding skill-category
**format label** was instead **rephrased** on the page (to "APIs & Event Streaming") rather than
allowlisted — the allowlist stays scoped to identity/tech nouns, never format vocabulary (and naming
the original label here would re-leak it, so it is described, not quoted). Tokens already carried by the example profile (`senior software engineer`, `application
developer`) were subtracted automatically and needed no entry.

**Decision — URL carve-out (one exact string).** The resume page publishes the LinkedIn profile URL.
URLs are a detected class, so this is a **single, exact-string exception**, not a blanket bypass: the
literal `https://www.linkedin.com/in/carlosgutz25/` is added to `PUBLISHED`. privacy-check
substring-matches the whole URL token with **no normalization**, so the published `<a href>`, the
`PUBLISHED` entry, and the `resume.md` source must be the **identical string including the trailing
slash** — otherwise the gate would pass by mismatch (a false pass) rather than by the carve-out. Every
other URL — private links, contact endpoints — stays fully detected. The header comment's
sensitive-class constraint and RISKS P-01/L-02 were reconciled to state this one exception explicitly.

**Demonstrated detection (gate law).** `scripts/privacy-check.test.mjs` proves, driving the real CLI:
(a) the four identity tokens clear while a distinctive fictional token AND a phone in the same file
still fail (token-scoped, not a blanket open); and (b) the URL carve-out is narrow — the exact
identity URL is cleared while a DIFFERENT LinkedIn URL still leaks (length-discriminated mask). The
red direction — removing the `PUBLISHED` entry re-leaks the real URL — was observed manually on the
branch before shipping (the carve-out is load-bearing, not decorative).

**Residual, named honestly.** Metro-level location is plain prose (not a bold/heading/table-cell,
email, URL, phone, or salary), so privacy-check does not extract it; it rides the **Pause-1 honesty
gate**. The published contact email is a publish-safe alias, deliberately distinct from the resume's
personal address (which stays fully detected).

# Dependency scanning: gates, settings, and exceptions

Supply-chain scanning for CareerForge (M13-02, from external exam EX-0002 finding
F-1). This doc is the human-readable companion to `dependabot.yml` and
`workflows/dependency-scan.yml`; it records what is reproducible from the repo vs
what lives in account settings, and the process for accepting an advisory.

## The two active gates

1. **dependency-review** (`dependency-scan.yml`, on `pull_request`). Diff-based:
   fails a PR that INTRODUCES a high/critical advisory in a production
   (`runtime`) dependency, relative to the base branch. It does not flag
   advisories already present in `main` (those are the audit job's remit). Reads
   GitHub's dependency graph.
2. **audit** (`dependency-scan.yml`, on `schedule` weekly + `workflow_dispatch`).
   Runs `pnpm audit --prod --audit-level=high`, catching advisories DISCLOSED
   against dependencies already in `main`. Scheduled rather than per-PR so
   unrelated PRs do not inherit npm-registry network flake. `--audit-level=high`
   means moderate/low advisories are printed but do not fail the run.

Neither is a required status check. Making a check block merges is a
branch-protection ruleset edit, which is a deliberate-friction operator-only
action (proposed to the owner, never made by an automated change). These gates
report; the human merge decision weighs them.

## Reproducible-from-repo vs account-controlled (recorded 2026-08-03)

The gate must not silently depend on invisible account settings. Inventory via
`gh api repos/<owner>/careerforge`, `.../vulnerability-alerts`, and the dependency
review API:

| Setting | State | Controlled where | Does a gate depend on it? |
|---|---|---|---|
| Repository visibility | public | repo | Does not by itself enable the dependency graph (see next row). |
| **Dependency graph** | **DISABLED** | **repo toggle (Settings > Code security)** | **YES for dependency-review.** It is a repo feature, NOT always-on for public repos; with it off the action fails closed and the dependency review API returns 403. Must be enabled by the owner. The scheduled `pnpm audit` does NOT depend on it. |
| Dependabot alerts | disabled | repo/account toggle | No. Neither gate needs alerts enabled. |
| Dependabot security updates | disabled | repo/account toggle | No. `dependabot.yml` provides scheduled VERSION updates independently. |
| Secret scanning + push protection | enabled | repo/account toggle | Out of scope here (covered by `security.yml` gitleaks). |

Correction (recorded honestly): an earlier draft of this doc claimed the
dependency graph is always on and undisableable for public repos. That is WRONG,
and the gate's own first CI run on its introducing PR proved it - dependency-review
failed with "Dependency review is not supported on this repository" and the
dependency review API returned 403. **dependency-review therefore has a hard
operator PRECONDITION: the Dependency graph must be enabled in repo Settings**
(owner action, tracked with the operator items). The scheduled `pnpm audit` gate
needs no GitHub feature and is fully reproducible from this repo today. Enabling
Dependabot alerts and security updates is a separate optional owner action that
adds GitHub-generated security PRs on top.

## Triage a finding

1. Read the failing run: which package, which advisory (GHSA link), which paths,
   and whether a patched version exists (`pnpm why <pkg>` for the path).
2. Prefer to FIX: bump the direct dependency, or add a `pnpm.overrides` entry to
   force a patched transitive version, in the owning package. (Dependency edits
   are out of scope for the scanning config itself; they belong to the package
   that owns the dependency.)
3. If a fix is not yet possible, record a time-boxed EXCEPTION below and take the
   matching config action (`allow-ghsas` on the dependency-review step, or
   `pnpm.auditConfig.ignoreGhsas`), so the suppression is visible and expires.

## Exception register

Every exception is time-boxed and owner-attributed. An entry with a past `Expiry`
is itself a finding: either the fix landed (remove the row) or the exception is
renewed with fresh rationale. No open-ended suppressions.

| GHSA / advisory | Package | Scope | Rationale | Owner | Granted | Expiry | Config action |
|---|---|---|---|---|---|---|---|
| _(none)_ | | | | | | | |

## Known finding at introduction (not an exception)

At the time this gate landed, `pnpm audit --prod --audit-level=high` already
reported pre-existing high-severity advisories in `main` (fastify-family
`fast-uri` / `find-my-way` / `@fastify/static`, plus `postcss` and
`brace-expansion` in the build chain), all with published fixes. These are the
gate's first true positives, not exceptions: remediation (dependency bumps across
the owning packages) is tracked separately by the maintainer, and the scheduled
audit run stays red until those land. That redness is the intended alert.

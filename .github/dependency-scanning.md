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
`gh api repos/<owner>/careerforge` and `.../vulnerability-alerts`:

| Setting | State | Controlled where | Does a gate depend on it? |
|---|---|---|---|
| Repository visibility | public | repo | dependency graph is always on for public repos and cannot be disabled, so dependency-review works without any toggle |
| Dependabot alerts | disabled | repo/account toggle | No. Neither gate needs alerts enabled. |
| Dependabot security updates | disabled | repo/account toggle | No. `dependabot.yml` provides scheduled VERSION updates independently. |
| Secret scanning + push protection | enabled | repo/account toggle | Out of scope here (covered by `security.yml` gitleaks). |

Because both active gates read the public dependency graph (dependency-review) or
the npm registry (audit), they are fully reproducible from this repository.
Enabling Dependabot alerts and security updates would add GitHub-generated
security PRs on top; that is an owner action in repo Settings and is tracked as an
operator wish, not a dependency of these gates.

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

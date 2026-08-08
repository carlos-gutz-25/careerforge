---
paths: [".github/**", ".githooks/**", "scripts/**", "**/*.test.*", "**/*.config.*", ".lighthouseci/**", "eslint.config.js", ".gitattributes"]
---

# Verification gates — full mechanics

These are the load-bearing details behind CLAUDE.md's gate laws. Every rule here
was derived from a real defect in this repo; provenance is kept on purpose.

## Gate modifications: demonstrated detection, as a recipe
Any modification to a verification gate (privacy-check, cli-smoke, drift test,
allowlist test, CI checks) must include a demonstrated detection — a proven FAIL
on planted fictional data — in the same change. The M0-09 privacy-gate narrowing
was saved by exactly this; it is required, not fortunate.

That demonstrated detection ships as a REPRODUCIBLE RECIPE, not a narration: the
appliable `git diff` (or, where the mutation is not a diff at all, the exact
command that produces it), the command that runs it, the captured red, and the
restored green, so a second party can reproduce it without authoring the
mutation themselves. A hand-written "exact edit" does not qualify — that is the
form that turns out not to apply, proven on PR #175 where two such blocks were
never `--check`ed and `git apply` rejected them. Evidence a reviewer cannot
re-run is testimony. Ratified 2026-08-06 on PR #172, where the plants were sound
but existed only in the author's terminal, leaving an independent seat nothing
to check. The underlying discipline is mutation testing: do not trust that a
suite detects a defect, inject the defect and prove the suite kills it.

**PR-body publication surface (ops-board rider, 2026-08-06):** recipe diffs and
captured output in PR bodies are rendered publicly and are NOT scanned by the
privacy gate (it reads committed diffs only). Before publishing or editing a PR
body carrying recipe content: scan the body for real-profile content and say so
in the report. Recipe diffs carry SOURCE ONLY; captured red/green output must
come from FICTIONAL fixtures, never from a run over `docs/profile/`.

## Gate commands run bare
Gate commands run bare — never piped or filtered in ways that consume the exit
code (`pnpm lint | tail` reports tail's exit 0 — the M0-10 red-lint push); if
filtering is unavoidable, `set -o pipefail` first.

## Per-artifact NUL/C0-byte scan
Per-artifact NUL/C0-byte scan before gates, on the COMMITTED blob:
`git show <sha>:<path> | perl -ne 'exit 1 if /\x00/'` — a **pipe** preserves the
NUL; command substitution (`$(git show …)`) strips it, so the scan must pipe,
never capture. Source-byte law: files carry printable ASCII only; a needed
non-ASCII codepoint (incl. U+0000 in a guard literal) is a visible `\uXXXX`
escape, never a raw byte. This scan has caught real literal-NUL defects
repeatedly (the running strike counter lives in the BACKLOG ledger); M2-12 added
one more — a copy artifact put a raw NUL into a v2 prompt guard, flagged before
gates. Binary assets tracked as `binary` in a checked-in `.gitattributes`
(e.g. `*.woff2` font subsets, M8-03) are exempt from the printable-ASCII
source-byte law and the per-artifact NUL/C0 scan — they are legitimate non-text
blobs, not source. The NUL/C0 scan still runs on every TEXT blob in the diff;
the exemption is scoped to the declared-binary paths only.

## Manual smoke tests
Manual smoke tests authenticate with throwaway credentials created for the smoke
and removed after — never the real bootstrap pair. Smoke artifacts (cookie jars,
captured logs) stay in the session scratchpad and are deleted when the smoke
ends.

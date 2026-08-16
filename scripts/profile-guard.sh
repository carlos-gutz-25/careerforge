#!/usr/bin/env bash
# CI gate: FAIL if real career data (docs/profile) is tracked, under any byte
# or case disguise. This is the "private profile data absent" required check.
#
# Until 2026-08-15 this logic lived inline in .github/workflows/security.yml as
#   git ls-files | grep -q '^docs/profile/'
# which carried three bypasses, each proven live by review of PR #210 (whose
# pre-commit hook fixed the same classes on the opt-in side, leaving the
# REQUIRED gate strictly weaker than the unenforced one):
#
#   (a) QUOTED-PATH. git C-quotes a path containing a byte it considers
#       unprintable, wrapping it in double quotes - "docs/profile/r\303\251..."
#       starts with a quote, so ^docs/profile/ never anchors. quotePath=false
#       is NOT enough (git always quotes on a double quote, backslash, or
#       control byte); `-z` NUL-delimited output is never quoted for any byte.
#   (b) CASE. docs/Profile/... on the case-insensitive filesystem where
#       docs/profile actually lives is the same real data, unmatched.
#   (c) FILE-AT-PATH. A path that is exactly `docs/profile` (a file, no
#       trailing slash) stages real content and was unmatched.
#
# Fail-closed law (CLAUDE.md): a check that inspected NOTHING is not a pass.
# Every internal failure here exits 1.
set -uo pipefail

fail_closed() {
  echo "::error::profile-guard could not run ($1) - refusing to pass a check that did not execute."
  exit 1
}

command -v git >/dev/null 2>&1 || fail_closed "git not found on PATH"

list="$(mktemp)" || fail_closed "mktemp failed"
trap 'rm -f "$list"' EXIT

# -z: NUL-delimited, never C-quoted for any byte. quotePath=false is redundant
# beside -z but kept so a future edit that drops -z does not silently regress
# to the quoted form for the >0x80 class. --full-name: from a subdirectory,
# ls-files emits cwd-RELATIVE paths, so `docs/profile/x.md` became
# `profile/x.md` and matched nothing - a silent false pass for a human running
# this by hand from docs/. CI runs at the workspace root, but the guard should
# not depend on that. Proven by review 2026-08-15.
if ! git -c core.quotePath=false ls-files -z --full-name >"$list"; then
  fail_closed "git ls-files failed"
fi

# Case-insensitive match is load-bearing (bypass (b)); if the shell cannot
# provide it, the guard must not quietly degrade to case-sensitive.
shopt -s nocasematch 2>/dev/null || fail_closed "nocasematch unsupported in this shell"

found=0
n=0
while IFS= read -r -d '' p; do
  n=$((n + 1))
  case "$p" in
    docs/profile|docs/profile/*)
      echo "::error::tracked path '$p' is real career data (docs/profile) and must never be committed"
      found=1
      ;;
  esac
done <"$list"

# A repository with zero tracked files means the listing failed upstream of
# this loop, whatever git's exit code said. Inspecting nothing is not a pass.
[ "$n" -eq 0 ] && fail_closed "zero tracked files listed - a scan that inspected nothing is not a pass"

exit "$found"

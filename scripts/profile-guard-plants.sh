#!/usr/bin/env bash
# Planted-FAIL suite for scripts/profile-guard.sh (the "private profile data
# absent" required CI check). Verification law: any gate modification ships a
# demonstrated detection as a REPRODUCIBLE RECIPE a second party can re-run.
#
#   bash scripts/profile-guard-plants.sh            # guard at scripts/profile-guard.sh
#   bash scripts/profile-guard-plants.sh <path>     # any guard copy under test
#   bash scripts/profile-guard-plants.sh --legacy   # the pre-2026-08-15 inline
#                                                   # workflow logic, verbatim -
#                                                   # proves these plants KILL it
#
# Every case runs in its own throwaway repo under mktemp -d; nothing real is
# read or written. All planted content is FICTIONAL placeholder text.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/scripts/profile-guard.sh"
LEGACY=0
if [ "${1:-}" = "--legacy" ]; then
  LEGACY=1
elif [ -n "${1:-}" ]; then
  GUARD="$1"
fi

# The exact logic the workflow ran before this suite existed. Kept verbatim so
# the mutation leg is the command itself, not a hand-written approximation.
run_legacy() {
  if git ls-files | grep -q '^docs/profile/'; then
    return 1
  fi
  return 0
}

run_guard() {
  if [ "$LEGACY" = "1" ]; then
    run_legacy
  else
    bash "$GUARD"
  fi
}

pass=0
fail=0

check() { # $1=name  $2=expected-exit  $3=setup-fn
  local d rc
  d="$(mktemp -d)" || { echo "FATAL: mktemp -d failed"; exit 1; }
  (
    cd "$d" || exit 99
    git init -q
    git config user.email plant@example.invalid
    git config user.name plant
    "$3"
  )
  rc=0
  (cd "$d" && run_guard >/dev/null 2>&1) || rc=$?
  if [ "$rc" -eq "$2" ]; then
    echo "PASS  $1 (exit $rc)"
    pass=$((pass + 1))
  else
    echo "FAIL  $1 (expected exit $2, got $rc)"
    fail=$((fail + 1))
  fi
  rm -rf "$d"
}

# ── A-group: planted real-data shapes. The guard MUST exit 1 on every one. ──
a1() { mkdir -p docs/profile; printf 'fictional resume placeholder\n' >docs/profile/resume.md; git add -A; }
a2() { mkdir -p docs/profile; printf 'fictional accented placeholder\n' >"docs/profile/r$(printf '\303\251')sum$(printf '\303\251').md"; git add -A; }
a3() { mkdir -p docs/Profile; printf 'fictional case-variant placeholder\n' >docs/Profile/resume.md; git add -A; }
a4() { mkdir -p docs; printf 'fictional file-at-path placeholder\n' >docs/profile; git add -A; }
a5() { mkdir -p docs/profile; printf 'fictional quoted placeholder\n' >'docs/profile/my"cv".md'; git add -A; }
a6() { mkdir -p docs/profile; printf 'fictional control-byte placeholder\n' >"docs/profile/tab$(printf '\t')name.md"; git add -A; }
a7() { :; } # zero tracked files: a scan that inspected nothing is not a pass

check "A1 docs/profile/resume.md tracked"                 1 a1
check "A2 accented filename (C-quote bypass class)"       1 a2
check "A3 docs/Profile case variant"                      1 a3
check "A4 docs/profile as a FILE (no trailing slash)"     1 a4
check "A5 double-quote in filename (always-quoted class)" 1 a5
check "A6 control byte in filename (always-quoted class)" 1 a6
check "A7 zero tracked files fails CLOSED"                1 a7

# A8: git itself failing must fail closed, not report absence-of-findings.
a8_dir="$(mktemp -d)"
printf '#!/bin/sh\nexit 1\n' >"$a8_dir/git"
chmod +x "$a8_dir/git"
d="$(mktemp -d)"
(cd "$d" && /usr/bin/env git init -q && /usr/bin/env git config user.email p@example.invalid && /usr/bin/env git config user.name p && printf 'x\n' >f && /usr/bin/env git add f)
rc=0
(cd "$d" && PATH="$a8_dir:$PATH" run_guard >/dev/null 2>&1) || rc=$?
if [ "$rc" -eq 1 ]; then echo "PASS  A8 broken git fails CLOSED (exit $rc)"; pass=$((pass + 1)); else echo "FAIL  A8 broken git fails CLOSED (expected exit 1, got $rc)"; fail=$((fail + 1)); fi
rm -rf "$d" "$a8_dir"

# ── B-group: healthy shapes. The guard MUST exit 0 - a false block on the ──
# ── fictional twin or a lookalike is a regression, not caution.           ──
b1() { printf 'readme placeholder\n' >README.md; git add -A; }
b2() { mkdir -p docs/profile.example; printf 'fictional example profile\n' >docs/profile.example/resume.md; printf 'r\n' >README.md; git add -A; }
b3() { mkdir -p docs/profiles; printf 'lookalike dir, not the boundary\n' >docs/profiles/x.md; printf 'r\n' >README.md; git add -A; }
b4() { mkdir -p vendor/docs/profile; printf 'nested lookalike, not the root boundary\n' >vendor/docs/profile/x.md; printf 'r\n' >README.md; git add -A; }

check "B1 clean repo"                                     0 b1
check "B2 docs/profile.example (the fictional twin)"      0 b2
check "B3 docs/profiles lookalike prefix"                 0 b3
check "B4 nested x/docs/profile stays out of scope"       0 b4

echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

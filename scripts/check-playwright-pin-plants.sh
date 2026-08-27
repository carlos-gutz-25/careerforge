#!/usr/bin/env bash
# Planted-FAIL suite for scripts/check-playwright-pin.mjs (the M14-08 pin
# coupling guard, run in the required `test` job). Verification law: any gate
# modification ships a demonstrated detection as a REPRODUCIBLE RECIPE a second
# party can re-run.
#
#   bash scripts/check-playwright-pin-plants.sh          # the tracked guard
#   bash scripts/check-playwright-pin-plants.sh <path>   # any guard copy under test
#
# The <path> hook is what makes the firing control possible: ci.yml points this
# suite at a deliberately defective copy of the guard and requires the suite to
# KILL it. A plant suite that has never been seen to fail is not evidence that
# it can fail.
#
# The guard's invariant holds on a healthy tree, so a fresh guard is green on
# arrival and proves nothing by itself. Every case here fabricates a scratch
# Dockerfile under mktemp -d and passes a fabricated resolved version as an
# argument; nothing tracked is read or written, and no fixture is a real
# version fact.
#
# THERE IS DELIBERATELY NO GREEN CASE HERE. The pass path is proven by the
# guard STEP that runs immediately above this suite in the same job, against
# the real Dockerfile and the real lockfile-resolved version. Re-asserting it
# on a fabricated fixture would prove less, in a suite whose whole subject is
# checks that cannot fail.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/scripts/check-playwright-pin.mjs"
if [ -n "${1:-}" ]; then
  GUARD="$1"
fi

SCRATCH="$(mktemp -d)" || { echo "FATAL: mktemp -d failed" >&2; exit 1; }
trap 'rm -rf "$SCRATCH"' EXIT

pass=0
fail=0

# A fixture Dockerfile shaped like the real one, so the guard's extraction is
# exercised against realistic surroundings rather than a bare version string.
# $1 = whatever goes after `playwright@` on the bake line.
write_dockerfile() {
  cat >Dockerfile <<DOCKERFILE
# COUPLING: the version below must track the LOCKFILE-RESOLVED playwright.
RUN set -eux \\
    && npx -y playwright@$1 install --with-deps chromium \\
    && rm -rf /var/lib/apt/lists/*
DOCKERFILE
}

check() { # $1=name  $2=expected-exit  $3=setup-fn  $4=required-output-marker
  local d rc out resolved
  d="$(mktemp -d "$SCRATCH/case.XXXXXX")" || { echo "FATAL: mktemp -d failed" >&2; exit 1; }
  # A failed setup must be its own failure, not a vacuous pass. Every fixture
  # in this suite is a file the suite writes itself, and a failed write would
  # otherwise let a case "pass" through the guard's fail-closed path - the
  # cannot-run arm reporting success about a plant that never existed.
  if ! ( cd "$d" && "$3" ); then
    echo "FAIL  $1 (setup failed)"
    fail=$((fail + 1))
    return
  fi
  if [ ! -f "$d/Dockerfile" ] || [ ! -f "$d/resolved" ]; then
    echo "FAIL  $1 (setup produced no fixture)"
    fail=$((fail + 1))
    return
  fi
  resolved="$(cat "$d/resolved")"
  rc=0
  out="$(node "$GUARD" "$d/Dockerfile" "$resolved" 2>&1)" || rc=$?
  if [ "$rc" -ne "$2" ]; then
    echo "FAIL  $1 (expected exit $2, got $rc)"
    echo "      output: $out"
    fail=$((fail + 1))
  # The marker is what makes a plant assert WHY it red rather than merely that
  # it did. An exit code alone cannot tell detection apart from an unrelated
  # crash arriving at the same code.
  elif ! printf '%s' "$out" | grep -q "$4"; then
    echo "FAIL  $1 (exit $rc but output lacks marker '$4')"
    echo "      output: $out"
    fail=$((fail + 1))
  else
    echo "PASS  $1 (exit $rc) $out"
    pass=$((pass + 1))
  fi
}

# -- PLANT 1: the drift this guard exists to catch. 1.61.1 against 1.62.1 is --
# -- the REAL 2026-08-14 drift, not an invented one.                        --
p1() { write_dockerfile 1.61.1; printf '1.62.1' >resolved; }

# -- PLANT 2: an unparseable bake line. Proves the fail-closed rail rather   --
# -- than asserting it: an unreadable input is a failure OF THE GUARD, never --
# -- a pass of the invariant.                                               --
p2() { write_dockerfile 'not-a-version'; printf '1.62.1' >resolved; }

# -- PLANT 3: substring discriminacy. "1.62.11" CONTAINS "1.62.1", so a      --
# -- substring or prefix comparison passes this and only a real equality     --
# -- test reds it. Without this leg the guard could be matching loosely and  --
# -- nobody would know. This is also the case the firing control turns on.   --
p3() { write_dockerfile 1.62.11; printf '1.62.1' >resolved; }

# -- PLANT 5: malformed resolved version - the leg most likely to fire in    --
# -- production, because a broken install is far commoner than a drifted     --
# -- pin. ci.yml's extraction publishes `version=` on ANY failure, so this   --
# -- is the shape that reaches the guard during an outage. The guard must    --
# -- not be the thing that reports "pin OK" while playwright is broken.      --
p5a() { write_dockerfile 1.62.1; printf '' >resolved; }
p5b() { write_dockerfile 1.62.1; printf 'not-a-version' >resolved; }
p5c() { write_dockerfile 1.62.1; printf '1.62' >resolved; }

check "PLANT 1  baked 1.61.1 vs resolved 1.62.1 (the real drift)"   1 p1  "PIN MISMATCH"
check "PLANT 2  bake line does not parse"                           2 p2  "CANNOT DETERMINE"
check "PLANT 3  baked 1.62.11 vs resolved 1.62.1 (substring trap)"  1 p3  "PIN MISMATCH"
check "PLANT 5a resolved version EMPTY (the fail-open shape)"       2 p5a "CANNOT DETERMINE"
check "PLANT 5b resolved version not a version"                     2 p5b "CANNOT DETERMINE"
check "PLANT 5c resolved version truncated to 1.62"                 2 p5c "CANNOT DETERMINE"

echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

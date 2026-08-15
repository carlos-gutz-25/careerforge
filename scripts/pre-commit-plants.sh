#!/usr/bin/env bash
# Planted-FAIL recipe for .githooks/pre-commit (careerforge).
#
# Self-contained and re-runnable by a second party: it builds throwaway repos,
# installs the hook under test, plants each condition, and prints the exit code
# beside the expected one. No state outside its own temp dir is touched.
#
# Run with:  bash scripts/pre-commit-plants.sh
# or against any other copy:  bash scripts/pre-commit-plants.sh /path/to/pre-commit
# The hook is bash, NOT zsh - a SIGPIPE fail-open reproduces in bash 3.2 and
# not in zsh, so running this under the interactive shell gives a wrong answer.
#
# NOTE ON CONTROLS: the firing control is a GitHub PAT generated AT RUNTIME.
# AWS's published example key is NOT used - gitleaks allowlists it, so the
# control silently fails to fire and "no leaks found" stops being evidence.
# Nothing token-shaped is ever written into this file.

set -uo pipefail

# Defaults to this repo's hook so the recipe is one command, and accepts a
# path so the same harness can be pointed at an OLD copy to prove it still
# kills the defects (mutation testing - see the PR body).
HOOK="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.githooks/pre-commit"}"
HOOK="$(cd "$(dirname "$HOOK")" && pwd)/$(basename "$HOOK")"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

pass=0
fail=0

fresh() {
  local d="$ROOT/$1"
  rm -rf "$d"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email plant@example.invalid
  git -C "$d" config user.name Plant
  mkdir -p "$d/.githooks"
  cp "$HOOK" "$d/.githooks/pre-commit"
  chmod +x "$d/.githooks/pre-commit"
  git -C "$d" config core.hooksPath .githooks
  echo "$d"
}

run_hook() {
  # Run the hook exactly as git would: from the worktree root, under bash.
  ( cd "$1" && bash .githooks/pre-commit >/dev/null 2>&1 )
  echo $?
}

check() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    printf '  PASS  %-58s exit=%s\n' "$name" "$got"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-58s exit=%s (expected %s)\n' "$name" "$got" "$want"
    fail=$((fail + 1))
  fi
}

# A PAT-shaped string built at runtime from parts, so this file never contains
# a token-shaped literal that a later scan would trip over.
fake_pat() {
  local prefix
  prefix="$(printf 'gh%s_' p)"
  printf '%s%s' "$prefix" "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
}

echo "=== gitleaks in use ==="
gitleaks version
echo "=== bash in use ==="
bash --version | head -1
echo

echo "--- GROUP A: the guard must FIRE (exit 1) ---"

d="$(fresh a1)"
printf 'token: %s\n' "$(fake_pat)" > "$d/leak.txt"
git -C "$d" add leak.txt
check "A1 planted PAT is detected (firing control)" "$(run_hook "$d")" 1

d="$(fresh a2)"
mkdir -p "$d/docs/profile"
echo "real career data" > "$d/docs/profile/resume.md"
git -C "$d" add -f docs/profile/resume.md
check "A2 docs/profile staged" "$(run_hook "$d")" 1

# The SIGPIPE case. grep -q exits at the first match, killing the writer with
# status 141; under pipefail the MATCHING case then reads as "no match". It
# needs enough staged paths to fill the pipe buffer, and the profile path must
# sort BEFORE the bulk so grep can exit early - git emits sorted order.
#
# SIZING MATTERS, and getting it wrong makes this test worthless. A first cut
# used 2500 short paths (~35 KB of path text) and did NOT reproduce the
# fail-open, because the whole list fits inside the 64 KB pipe buffer and the
# writer never blocks. The bulk below is deliberately sized past that: 3000
# paths with long names, ~150 KB of text. Verified to still kill the defective
# version - see the mutation run in the PR body.
d="$(fresh a3)"
bulkdir="zbulk-with-a-deliberately-long-directory-name-to-fill-the-pipe-buffer"
mkdir -p "$d/docs/profile" "$d/$bulkdir"
echo "real career data" > "$d/docs/profile/resume.md"
for i in $(seq 1 3000); do
  : > "$d/$bulkdir/padding-file-with-a-long-name-number-$i.txt"
done
git -C "$d" add -f docs/profile/resume.md "$bulkdir"
printf '    (A3 staged path text: %s bytes)\n' \
  "$(git -C "$d" diff --cached --name-only | wc -c | tr -d ' ')"
check "A3 docs/profile among 3000 later-sorting paths (SIGPIPE)" "$(run_hook "$d")" 1

# The quotePath case. git quotes non-ASCII paths by default, prefixing a
# double quote, so a ^docs/profile/ anchor never matches.
d="$(fresh a4)"
mkdir -p "$d/docs/profile"
printf 'real career data\n' > "$d/docs/profile/$(printf 'R\303\251sum\303\251').md"
git -C "$d" add -f docs/profile
check "A4 docs/profile with a non-ASCII filename" "$(run_hook "$d")" 1

# git C-quotes these three whatever core.quotePath says, so quotePath=false was
# not enough on its own - all three bypassed the guard with real data staged.
# Only NUL-delimited listing (--name-only -z) is immune.
i=0
for name in 'my"resume".md' 'back\slash.md' "$(printf 'tab\tname.md')"; do
  i=$((i + 1))
  d="$(fresh "a4q$i")"
  mkdir -p "$d/docs/profile"
  printf 'real career data\n' > "$d/docs/profile/$name"
  git -C "$d" add -f docs/profile
  check "A4q$i docs/profile path git C-quotes" "$(run_hook "$d")" 1
done

# macOS sets core.ignorecase, so this is the SAME directory on disk.
d="$(fresh a4c)"
mkdir -p "$d/docs/Profile"
printf 'real career data\n' > "$d/docs/Profile/resume.md"
git -C "$d" add -f docs/Profile
check "A4c docs/Profile with a capital P" "$(run_hook "$d")" 1

# Scanner drift must fail CLOSED: a gitleaks that prints nothing at all.
d="$(fresh a5)"
mkdir -p "$d/stub"
printf '#!/bin/sh\nexit 0\n' > "$d/stub/gitleaks"
chmod +x "$d/stub/gitleaks"
echo "content" > "$d/file.txt"
git -C "$d" add file.txt
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "A5 silent gitleaks (no scanned-byte line) fails closed" "$got" 1

# The original defect: a scan that inspected nothing while content was staged.
d="$(fresh a6)"
mkdir -p "$d/stub"
printf '#!/bin/sh\necho "scanned ~0 bytes (0) in 1ms"\nexit 0\n' > "$d/stub/gitleaks"
chmod +x "$d/stub/gitleaks"
echo "content" > "$d/file.txt"
git -C "$d" add file.txt
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "A6 scanned 0 bytes while diff adds content" "$got" 1

echo
echo "--- GROUP B: the guard must NOT fire (exit 0) ---"

d="$(fresh b1)"
echo "ordinary source" > "$d/file.txt"
git -C "$d" add file.txt
check "B1 ordinary commit with content" "$(run_hook "$d")" 0

# Pure deletion adds zero bytes, so a zero-byte scan is CORRECT, not a defect.
d="$(fresh b2)"
echo "ordinary source" > "$d/file.txt"
git -C "$d" add file.txt
git -C "$d" -c core.hooksPath=/dev/null commit -qm seed
git -C "$d" rm -q file.txt
check "B2 pure deletion commit" "$(run_hook "$d")" 0

d="$(fresh b3)"
mkdir -p "$d/packages/newpkg"
: > "$d/packages/newpkg/.gitkeep"
git -C "$d" add packages/newpkg/.gitkeep
check "B3 only an empty .gitkeep staged" "$(run_hook "$d")" 0

d="$(fresh b4)"
mkdir -p "$d/docs/profile.example"
echo "fictional profile" > "$d/docs/profile.example/resume.md"
git -C "$d" add docs/profile.example
check "B4 docs/profile.example is NOT docs/profile" "$(run_hook "$d")" 0

# A rename adds no new content on the added side beyond the moved bytes; make
# sure the added-content accounting does not reject it.
d="$(fresh b5)"
echo "ordinary source" > "$d/old.txt"
git -C "$d" add old.txt
git -C "$d" -c core.hooksPath=/dev/null commit -qm seed
git -C "$d" mv old.txt new.txt
check "B5 pure rename" "$(run_hook "$d")" 0

# BINARY. gitleaks legitimately scans zero bytes of binary content, so an
# all-binary commit MUST NOT be treated as "content staged but not scanned".
# An earlier fix counted binary rows as content and blocked every one of
# these - fonts, images, icons, PDFs - which is a worse gate than no gate,
# because the only escape is --no-verify and that turns the scan off entirely.
d="$(fresh b6)"
head -c 4096 /dev/urandom > "$d/asset.woff2"
git -C "$d" add asset.woff2
check "B6 binary-only commit (a font)" "$(run_hook "$d")" 0

d="$(fresh b7)"
head -c 4096 /dev/urandom > "$d/image.png"
git -C "$d" add image.png
git -C "$d" -c core.hooksPath=/dev/null commit -qm seed
git -C "$d" rm -q image.png
check "B7 deleting a binary file" "$(run_hook "$d")" 0

d="$(fresh b8)"
head -c 4096 /dev/urandom > "$d/image.png"
git -C "$d" add image.png
git -C "$d" -c core.hooksPath=/dev/null commit -qm seed
git -C "$d" mv image.png pic.png
check "B8 renaming a binary file" "$(run_hook "$d")" 0

# Mixed text+binary must still be scanned, and a planted secret in the TEXT
# half must still fire - proving the binary allowance did not open a hole.
d="$(fresh b9)"
head -c 4096 /dev/urandom > "$d/asset.woff2"
printf 'token: %s\n' "$(fake_pat)" > "$d/leak.txt"
git -C "$d" add asset.woff2 leak.txt
check "B9 secret in the text half of a mixed commit" "$(run_hook "$d")" 1

echo
echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

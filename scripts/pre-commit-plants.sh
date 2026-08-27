#!/usr/bin/env bash
# Planted-FAIL recipe for .githooks/pre-commit (careerforge).
#
# Self-contained and re-runnable by a second party: it builds throwaway repos,
# installs the hook under test, plants each condition, and prints the exit code
# beside the expected one. No state outside its own temp dir is touched.
#
# Run with:  bash scripts/pre-commit-plants.sh
# or against any other copy:  bash scripts/pre-commit-plants.sh /path/to/pre-commit
# The hook is bash, NOT zsh, so run it under bash - that part is right and
# matters. The REASON an earlier version of this comment gave was wrong: it
# claimed the SIGPIPE fail-open "reproduces in bash 3.2 and not in zsh".
# Measured, `set -o pipefail; seq 1 200000 | grep -q '^1$'` returns 141 in BOTH
# /bin/bash and /bin/zsh. Run it in bash because that is the interpreter in the
# shebang, not because zsh would hide the defect.
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

# Captured before any PATH manipulation, so the git stub in A7 can forward to
# the real binary rather than recursing into itself.
REAL_GIT="$(command -v git)"

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

# A FILE named exactly docs/profile, with no trailing slash. This was left open
# once on the recorded grounds that "such an entry stages no content" - false:
# it stages like any other file, and .gitignore's `docs/profile/` rule does not
# cover it either, so no `git add -f` is needed.
d="$(fresh a8)"
mkdir -p "$d/docs"
printf 'real career data\n' > "$d/docs/profile"
git -C "$d" add docs/profile
check "A8 a FILE named exactly docs/profile" "$(run_hook "$d")" 1

# The other half of the listing fail-open: a git that exits 0 while producing
# NOTHING. The status check cannot see that, so the two listings are
# cross-checked against each other instead - a non-empty diffstat with an empty
# name-only listing means one of them did not report.
d="$(fresh a9)"
mkdir -p "$d/stub" "$d/docs/profile"
echo "real career data" > "$d/docs/profile/resume.md"
git -C "$d" add -f docs/profile/resume.md
cat > "$d/stub/git" <<STUBEOF
#!/bin/sh
for a in "\$@"; do
  if [ "\$a" = "--name-only" ]; then
    for b in "\$@"; do [ "\$b" = "-z" ] && exit 0; done
  fi
done
exec "$REAL_GIT" "\$@"
STUBEOF
chmod +x "$d/stub/git"
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "A9 git exits 0 but lists nothing" "$got" 1

# Scanner drift must fail CLOSED: a gitleaks that prints nothing at all.
d="$(fresh a5)"
mkdir -p "$d/stub"
printf '#!/bin/sh\nexit 0\n' > "$d/stub/gitleaks"
chmod +x "$d/stub/gitleaks"
echo "content" > "$d/file.txt"
git -C "$d" add file.txt
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "A5 silent gitleaks (no scanned-byte line) fails closed" "$got" 1

# If the STAGED LISTING itself fails, the guard must not proceed with an empty
# list. The shape `while read ...; done < <(git ...) || { fail }` does exactly
# that: `||` binds to the while loop's status, never to the process
# substitution, so a failing git yielded an empty array and docs/profile
# sailed through. Stub git so only that one invocation fails.
d="$(fresh a7)"
mkdir -p "$d/stub" "$d/docs/profile"
echo "real career data" > "$d/docs/profile/resume.md"
git -C "$d" add -f docs/profile/resume.md
cat > "$d/stub/git" <<STUBEOF
#!/bin/sh
for a in "\$@"; do
  if [ "\$a" = "--name-only" ]; then
    for b in "\$@"; do [ "\$b" = "-z" ] && exit 1; done
  fi
done
exec "$REAL_GIT" "\$@"
STUBEOF
chmod +x "$d/stub/git"
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "A7 staged-listing failure must not pass an empty list" "$got" 1

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

# Mixed text+binary: a planted secret in the TEXT half must still fire, so the
# binary allowance did not stop the text half being scanned.
#
# NOTE ON WHAT THIS DOES AND DOES NOT PROVE. An earlier commit message claimed
# this case proved "the allowance did not open a hole". It does not: it plants
# the secret in the half the allowance never touched. The case that tests the
# claim is B10, and B10 shows the hole is real. Kept here, correctly scoped.
d="$(fresh b9)"
head -c 4096 /dev/urandom > "$d/asset.woff2"
printf 'token: %s\n' "$(fake_pat)" > "$d/leak.txt"
git -C "$d" add asset.woff2 leak.txt
check "B9 secret in the TEXT half of a mixed commit (fires)" "$(run_hook "$d")" 1

# B10-B12: THE BINARY-CONTENT HOLE, NOW ASSERTED RATHER THAN CHARACTERISED.
#
# B10 was a CHARACTERIZATION test pinning behaviour that was wrong but accepted
# (expect 0), so the gap stayed visible in the harness instead of living only in
# a comment. The hook's own comment wrote the contract: "when it is closed, B10
# goes red and gets rewritten to assert the block." Check 4 closed it, so these
# now assert the BLOCK.
#
# "binary" is git's DIFF-TIME POLICY, not a property of the bytes, so there are
# THREE independent routes into the hole and each gets its own case. Folding
# them into one would leave two routes untested while looking covered - and the
# third is the least obvious and the most alarming, because the file is 100%
# plain ASCII.
d="$(fresh b10)"
printf 'token: %s\n' "$(fake_pat)" > "$d/secrets.dat"
printf '*.dat binary\n' > "$d/.gitattributes"
git -C "$d" add .gitattributes secrets.dat
check "B10 route 1 .gitattributes binary: secret BLOCKED" "$(run_hook "$d")" 1

d="$(fresh b11)"
# One NUL byte anywhere makes git treat the whole file as binary.
{ printf 'token: %s\n' "$(fake_pat)"; printf '\000\n'; } > "$d/secrets.log"
git -C "$d" add secrets.log
check "B11 route 2 a single NUL byte: secret BLOCKED" "$(run_hook "$d")" 1

d="$(fresh b12)"
# Route 3, and it is the alarming one: this file is 100% plain ASCII with no
# .gitattributes marking and no NUL. It diffs as binary purely because it is
# past core.bigFileThreshold.
#
# THE THRESHOLD IS LOWERED TO 1k IN THIS THROWAWAY REPO ON PURPOSE (D7a).
# Reaching the real default honestly would need a >512MiB file, which is not a
# plant anyone should build. SAY WHAT THIS PROVES: it exercises the git POLICY
# path, which is what defines the hole. It is evidence about that path, NOT
# evidence about gitleaks' default configuration - claiming otherwise would be
# the vacuous-green shape wearing a new costume.
git -C "$d" config core.bigFileThreshold 1k
{ printf 'token: %s\n' "$(fake_pat)"; head -c 4096 /dev/zero | tr '\0' 'A'; printf '\n'; } > "$d/big.txt"
git -C "$d" add big.txt
check "B12 route 3 plain ASCII past bigFileThreshold: BLOCKED" "$(run_hook "$d")" 1

# B13 - THE SCAN-LOG SEPARATION PLANT. Check 3 parses the scanned-byte count
# with `tail -n 1`, so if check 4's binary scan ever appended to the SAME log,
# check 3 would silently stop measuring the TEXT scan and start measuring the
# binary one. No other plant in this file can see that swap: A6's stub prints 0
# for everything, so the suite would stay green while the check's MEANING moved.
#
# This plant makes the swap observable by giving the two scans DIFFERENT counts.
# The stub reports 0 bytes for `gitleaks git` (the text scan) and 4096 for
# `gitleaks dir` (the binary scan), and TEXT is staged, so:
#   - reading the TEXT count (0) with text staged  -> check 3 BLOCKS, exit 1.
#   - reading the BINARY count (4096) instead      -> check 3 passes, exit 0.
# Asserting exit 1 therefore asserts that check 3 still reads the text count.
d="$(fresh b13)"
mkdir -p "$d/stub"
cat > "$d/stub/gitleaks" <<'STUBEOF'
#!/bin/sh
case "${1:-}" in
  git) echo "scanned ~0 bytes (0) in 1ms"; echo "no leaks found"; exit 0 ;;
  dir) echo "scanned ~4096 bytes (4096) in 1ms"; echo "no leaks found"; exit 0 ;;
  version) echo "8.30.1"; exit 0 ;;
esac
exit 0
STUBEOF
chmod +x "$d/stub/gitleaks"
printf 'plain text line\n' > "$d/note.txt"
{ printf 'harmless\n'; printf '\000\n'; } > "$d/blob.bin"
git -C "$d" add note.txt blob.bin
got="$( cd "$d" && PATH="$d/stub:$PATH" bash .githooks/pre-commit >/dev/null 2>&1; echo $? )"
check "B13 check 3 reads the TEXT count, not the binary one" "$got" 1

# B14/B15 - THE FALSE-BLOCK SURFACE, held to the scope D4 promised. Check 4 was
# shippable only because it does NOT widen blocking to every staged file, so the
# suite has to prove the narrow cases still pass. Without these, a check 4 that
# blocked every binary commit would look perfectly healthy here.
d="$(fresh b14)"
head -c 4096 /dev/urandom > "$d/asset.woff2"
git -C "$d" add asset.woff2
check "B14 clean binary asset still COMMITS (no false block)" "$(run_hook "$d")" 0

d="$(fresh b15)"
head -c 4096 /dev/urandom > "$d/asset.woff2"
git -C "$d" add asset.woff2
git -C "$d" -c core.hooksPath=/dev/null commit -q -m seed
git -C "$d" rm -q asset.woff2
check "B15 DELETING a binary file still COMMITS (no blob to scan)" "$(run_hook "$d")" 0

echo
echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

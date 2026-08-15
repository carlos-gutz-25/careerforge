#!/usr/bin/env bash
# Planted-FAIL recipe for scripts/launchd/careerforge-backup-liveness.
#
# Self-contained and re-runnable by a second party: it builds a throwaway repo
# root and a throwaway backup directory, plants each state, runs THE SCRIPT
# (not the node probe inside it), and asserts both the exit code and the state
# tag the script logged. Nothing outside its own temp dir is touched, no
# launchd agent is loaded or kickstarted, and the real backup share is never
# read or written.
#
# Run with:  bash scripts/backup-liveness-plants.sh
# or against another copy:  bash scripts/backup-liveness-plants.sh /path/to/script
#
# WHY THIS EXISTS IN THIS SHAPE. The first version of the recipe for this
# change asked the reader to paste the node probe out of the script and run it
# by hand. That exercises the probe and nothing else - not the state machine,
# not the field parsing, not the age comparison, not the exit codes - which is
# precisely the layer where both of the silent false greens lived. Repo law
# (.claude/rules/verification.md) requires a recipe a second party can re-run
# without authoring the mutation themselves, so it is tracked code.
#
# TWO MECHANICAL NOTES, both learned the hard way:
#
#  - The script is `#!/bin/zsh -l`. Run through its shebang, the login shell
#    sources the user profile, macOS path_helper reorders PATH, and a stub
#    directory prepended by this harness ends up AFTER /usr/bin - so the REAL
#    /usr/bin/osascript wins and every alert plant fires a real desktop
#    notification. This harness therefore invokes `zsh "$SCRIPT"` directly,
#    which skips profile loading and lets the stub shadow osascript. That is
#    also why the stub is required and not merely tidy.
#  - HOME is redirected so the script's log lands in the temp dir instead of
#    the operator's real ~/Library/Logs.

set -uo pipefail

SCRIPT_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/launchd/careerforge-backup-liveness"
SCRIPT="${1:-$SCRIPT_DEFAULT}"
[ -r "$SCRIPT" ] || { echo "cannot read $SCRIPT" >&2; exit 2; }

ROOT="$(mktemp -d)"
trap 'chmod -R u+rwx "$ROOT" 2>/dev/null; rm -rf "$ROOT"' EXIT

pass=0
fail=0

# Fake repo root laid out the way ${0:A:h}/../.. expects, plus a fake HOME and
# a stub osascript so no desktop notification is ever raised.
FAKE_HOME="$ROOT/home"
REPO="$ROOT/repo"
STUB="$ROOT/stub"
mkdir -p "$FAKE_HOME/Library/Logs" "$REPO/scripts/launchd" "$STUB"
cp "$SCRIPT" "$REPO/scripts/launchd/careerforge-backup-liveness"
chmod +x "$REPO/scripts/launchd/careerforge-backup-liveness"
printf '#!/bin/sh\nexit 0\n' > "$STUB/osascript"
chmod +x "$STUB/osascript"

LOG="$FAKE_HOME/Library/Logs/careerforge-backup-liveness.log"

# $1 = BACKUP_DIR value ("" to omit the key entirely)
# $2 = optional extra .env line
write_env() {
  : > "$REPO/.env"
  [ -n "$1" ] && echo "BACKUP_DIR=$1" >> "$REPO/.env"
  [ -n "${2:-}" ] && echo "$2" >> "$REPO/.env"
  return 0
}

# Plant a dump/profile pair. $1 = dir, $2 = age spec for `date -v`, $3 = size
plant_pair() {
  local dir="$1" agespec="$2" size="$3"
  mkdir -p "$dir"
  local stamp db prof
  stamp="$(date -v"$agespec" '+%Y%m%d-%H%M%S')"
  db="$dir/careerforge-db-$stamp.dump.age"
  prof="$dir/careerforge-profile-$stamp.tar.age"
  if [ "$size" = "0" ]; then : > "$db"; else head -c "$size" /dev/zero > "$db"; fi
  head -c 128 /dev/zero > "$prof"
  local touchstamp
  touchstamp="$(date -v"$agespec" '+%Y%m%d%H%M.%S')"
  touch -t "$touchstamp" "$db" "$prof"
}

run_script() {
  ( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" \
      zsh "$REPO/scripts/launchd/careerforge-backup-liveness" >/dev/null 2>&1 )
  echo $?
}

# $1 name, $2 expected exit, $3 expected tag in the log line
check() {
  local name="$1" want_exit="$2" want_tag="$3"
  local got_exit last
  : > "$LOG"
  got_exit="$(run_script)"
  last="$(tail -n 1 "$LOG" 2>/dev/null)"
  if [ "$got_exit" = "$want_exit" ] && [[ "$last" == *"$want_tag"* ]]; then
    printf '  PASS  %-46s exit=%s  %s\n' "$name" "$got_exit" "$want_tag"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s exit=%s (want %s)  log=%s\n' \
      "$name" "$got_exit" "$want_exit" "${last:-<empty>}"
    fail=$((fail + 1))
  fi
}

echo "=== script under test: $SCRIPT"
echo "=== node: $(node --version)  zsh: $(zsh --version | head -1)"
echo

echo "--- GROUP A: healthy (exit 0) ---"
BD="$ROOT/backups"
write_env "$BD"
rm -rf "$BD"; plant_pair "$BD" -2H 4096
check "A1 fresh dump and profile" 0 "OK:"

# A pipe in a filename shifted every field in the previous delimiter-based
# parse, fed a non-numeric value to the age comparison, and fell through to OK.
rm -rf "$BD"; plant_pair "$BD" -2H 4096
# NEWEST and non-empty on purpose. It has to be the newest for this to be a
# real test: the delimiter bug only bit when the pipe-bearing name was the one
# whose fields got parsed. Non-empty because a first cut of this line used
# `touch`, which made it both newest AND zero-byte, so it planted ZEROSIZE and
# tested that instead - the script was right and the plant was wrong, which is
# the harness earning its keep.
head -c 128 /dev/zero > "$BD/careerforge-db-2026|weird.dump.age"
touch -t "$(date -v-1H '+%Y%m%d%H%M.%S')" "$BD/careerforge-db-2026|weird.dump.age"
# Asserting on the FILENAME, not merely on exit 0. Under the old delimiter
# parse this case also exited 0 and also logged "OK:" - it just logged a
# garbled line ("newest artifact weird.dump.ageh old (careerforge-db-2026)").
# Exit code alone therefore cannot tell the two apart, and a plant that cannot
# tell them apart is not evidence.
check "A2 a '|' in a filename does not shift the parse" 0 "careerforge-db-2026|weird.dump.age"

echo
echo "--- GROUP B: the two silent false greens (exit 1) ---"
rm -rf "$BD"; plant_pair "$BD" +5H 4096
check "B1 FUTURE mtime is not healthy" 1 "[FUTURE]"

rm -rf "$BD"; plant_pair "$BD" -2H 0
check "B2 zero-byte newest dump" 1 "[ZEROSIZE]"

echo
echo "--- GROUP C: coverage gaps that used to stay green (exit 1) ---"
rm -rf "$BD"; plant_pair "$BD" -2H 4096
rm -f "$BD"/careerforge-profile-*.tar.age
check "C1 profile archive missing, dump fine" 1 "[EMPTY]"

rm -rf "$BD"; plant_pair "$BD" -2H 4096
# Age only the profile family, leaving the dump fresh.
touch -t "$(date -v-200H '+%Y%m%d%H%M.%S')" "$BD"/careerforge-profile-*.tar.age
check "C2 profile archive stale, dump fresh" 1 "[STALE]"

echo
echo "--- GROUP D: states the first fix already handled (exit 1) ---"
rm -rf "$BD"; plant_pair "$BD" -200H 4096
check "D1 everything stale" 1 "[STALE]"

rm -rf "$BD"; mkdir -p "$BD"
check "D2 directory present but empty" 1 "[EMPTY]"

rm -rf "$BD"
check "D3 directory absent" 1 "[UNREACHABLE]"

rm -rf "$BD"; : > "$BD"
check "D4 BACKUP_DIR points at a file" 1 "[UNREACHABLE]"

rm -rf "$BD"; plant_pair "$BD" -2H 4096; chmod 000 "$BD"
check "D5 readdir denied" 1 "[DENIED]"
chmod 755 "$BD"

write_env ""
check "D6 BACKUP_DIR unset in .env" 1 "[UNREACHABLE]"

echo
echo "--- GROUP E: the threshold is really configurable (exit 1) ---"
# RUNBOOKS claimed this was settable while the code read the process
# environment only, which launchd never supplies - so it was permanently 26.
rm -rf "$BD"; write_env "$BD" "BACKUP_LIVENESS_MAX_AGE_HOURS=1"; plant_pair "$BD" -2H 4096
check "E1 threshold from .env is honored" 1 "[STALE]"

write_env "$BD" "BACKUP_LIVENESS_MAX_AGE_HOURS=notanumber"
check "E2 non-numeric threshold is refused, not defaulted" 1 "[ERROR]"

echo
echo "--- GROUP F: the guards themselves fail CLOSED (exit 1) ---"
# The probe cannot produce these values, so they are injected by stubbing node.
# That is the point: a guard is only evidence once it has been seen to fire, and
# these are the shapes that reproduce the ORIGINAL defect from inside the guard
# written to prevent it. Found by adversarial review of the first fix.
stub_node() {
  printf '#!/bin/sh\ncat <<%s\n%s\n%s\n' 'PROBE_EOF' "$1" 'PROBE_EOF' > "$STUB/node"
  chmod +x "$STUB/node"
}
unstub_node() { rm -f "$STUB/node"; }

rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096

stub_node "$(printf 'OK\n-\n1\n--\n4096\ndb.dump.age\n1\n2\n128\nprofile.tar.age')"
check "F1 age of '--' is refused, not logged OK" 1 "[ERROR]"

stub_node "$(printf 'OK\n-\n1\n1-2\n4096\ndb.dump.age\n1\n2\n128\nprofile.tar.age')"
check "F2 age of '1-2' is refused, not logged OK" 1 "[ERROR]"

stub_node "$(printf 'OK\n-\n1\n2\nnotanumber\ndb.dump.age\n1\n2\n128\nprofile.tar.age')"
check "F3 non-numeric size is refused" 1 "[ERROR]"

stub_node "$(printf 'OK\n-\n1\n2')"
check "F4 short field count is refused" 1 "[ERROR]"

unstub_node

# A threshold of 0 would alert STALE every morning on a healthy backup - the
# alert fatigue this file exists to end, from a one-character typo.
write_env "$BD" "BACKUP_LIVENESS_MAX_AGE_HOURS=0"
check "F5 threshold of 0 is refused" 1 "[ERROR]"

# Present-but-empty is a typo, not an absence, so it must not silently default.
write_env "$BD" "BACKUP_LIVENESS_MAX_AGE_HOURS="
check "F6 threshold present but empty is refused" 1 "[ERROR]"

echo
echo "--- GROUP H: a hostile filename cannot reach AppleScript as code ---"
# The alert messages embed the newest filename, and the family regex allows a
# filename to contain a double quote. Interpolating that into `osascript -e`
# closed the string literal and evaluated the rest as AppleScript - code
# execution as the logged-in user, from a file dropped on the SMB share, at
# 09:00, by the one check whose whole job is to be trustworthy.
rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096
# The payload carries NO SLASH: a slash would make it a path through
# directories that do not exist, and the plant would fail to create its own
# fixture rather than testing anything. (A first cut did exactly that.)
# Zero bytes so the ZEROSIZE alert fires and puts the name into the message.
PAYLOAD_NAME='careerforge-db-2026" & (do shell script "id") & ".dump.age'
: > "$BD/$PAYLOAD_NAME"
touch -t "$(date -v-1H '+%Y%m%d%H%M.%S')" "$BD/$PAYLOAD_NAME"

# The stub records argv, which is what discriminates the fix from the defect:
#   FIXED  - the message arrives as its OWN argument, after `--`.
#   BROKEN - the message is interpolated into the script text, so a single
#            argument contains BOTH `display notification` AND the payload.
# Asserting only "the payload appears somewhere in argv" would pass on both.
OSA_ARGV_LOG="$ROOT/osa-argv.txt"
cat > "$STUB/osascript" <<OSA
#!/bin/sh
: > "$OSA_ARGV_LOG"
for a in "\$@"; do printf '%s\n' "\$a" >> "$OSA_ARGV_LOG"; done
exit 0
OSA
chmod +x "$STUB/osascript"
: > "$LOG"
( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" \
    zsh "$REPO/scripts/launchd/careerforge-backup-liveness" >/dev/null 2>&1 )
h_exit=$?
if grep -q 'display notification.*do shell script' "$OSA_ARGV_LOG" 2>/dev/null; then
  printf '  FAIL  %-46s *** payload INTERPOLATED into script text ***\n' "H1 hostile filename reaches osascript as DATA"
  fail=$((fail + 1))
elif grep -qx '.*do shell script "id".*' "$OSA_ARGV_LOG" 2>/dev/null && [ "$h_exit" = 1 ]; then
  printf '  PASS  %-46s exit=%s (payload is a separate argument)\n' "H1 hostile filename reaches osascript as DATA" "$h_exit"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s exit=%s argv=%s\n' "H1 hostile filename reaches osascript as DATA" "$h_exit" "$(tr '\n' '|' < "$OSA_ARGV_LOG" 2>/dev/null)"
  fail=$((fail + 1))
fi
printf '#!/bin/sh\nexit 0\n' > "$STUB/osascript"; chmod +x "$STUB/osascript"

echo
echo "--- GROUP G: healthy runs are silent on stderr ---"
# The other checks read only the log and the exit code, so a run that emitted
# zsh errors while still logging OK would pass them - which is exactly how the
# GROUP F leak stayed invisible. This asserts the absence of that noise.
rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096
: > "$LOG"
err="$( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" \
        zsh "$REPO/scripts/launchd/careerforge-backup-liveness" 2>&1 >/dev/null )"
g_exit=$?
g_log="$(tail -n 1 "$LOG" 2>/dev/null)"
# Asserting the run was HEALTHY as well as quiet. An earlier version checked
# stderr only, so deleting the `unstub_node` call above left the stubbed probe
# in place, the run alerted ERROR and exited 1, and G1 still passed - a check
# that cannot tell a healthy run from a broken one.
if [ -z "$err" ] && [ "$g_exit" = 0 ] && [[ "$g_log" == *"OK:"* ]]; then
  printf '  PASS  %-46s exit=0, stderr empty\n' "G1 healthy run is silent AND healthy"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s exit=%s stderr=%s log=%s\n' "G1 healthy run is silent AND healthy" "$g_exit" "$err" "$g_log"
  fail=$((fail + 1))
fi

echo
echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

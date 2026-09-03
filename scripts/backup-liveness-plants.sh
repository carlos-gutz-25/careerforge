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
mkdir -p "$FAKE_HOME/Library/Logs" "$REPO/scripts/launchd" "$STUB" "$ROOT/kura-config"
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

# KURA_CONFIG_DIR is redirected into the temp root on EVERY run, not only in
# the intel group (M16-10 D27). The intel checks shell out to `kura`, and the
# real one is on the operator's PATH: if a case ever reached it unstubbed it
# would read the live roster and make ssh calls to a real machine, and a plant
# suite that touches the network has stopped being a plant suite. Pointed at an
# empty directory, even an unstubbed kura finds nothing to act on.
run_script() {
  ( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" KURA_CONFIG_DIR="$ROOT/kura-config" \
      zsh "$REPO/scripts/launchd/careerforge-backup-liveness" "$@" >/dev/null 2>&1 )
  echo $?
}

# $1 name, $2 expected exit, $3 expected tag in the log line, $4.. script args
check() {
  local name="$1" want_exit="$2" want_tag="$3"
  shift 3
  local got_exit last
  : > "$LOG"
  got_exit="$(run_script "$@")"
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

# The {1,6} bound: past 18 digits zsh truncates, the comparison evaluates
# false, and control falls through to log OK - the original defect, in the one
# place the value is operator-supplied. Nothing covered this until now.
rm -rf "$BD"; write_env "$BD" "BACKUP_LIVENESS_MAX_AGE_HOURS=9999999999999999999"; plant_pair "$BD" -2H 4096
check "F7 a 19-digit threshold is refused" 1 "[ERROR]"

# An EMPTY value in the process environment, as opposed to in .env.
rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096
: > "$LOG"
f8_exit="$( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" BACKUP_LIVENESS_MAX_AGE_HOURS= \
    zsh "$REPO/scripts/launchd/careerforge-backup-liveness" >/dev/null 2>&1; echo $? )"
f8_log="$(tail -n 1 "$LOG")"
if [ "$f8_exit" = 1 ] && [[ "$f8_log" == *"[ERROR]"* ]]; then
  printf '  PASS  %-46s exit=1  [ERROR]\n' "F8 empty threshold in the ENVIRONMENT is refused"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s exit=%s log=%s\n' "F8 empty threshold in the ENVIRONMENT is refused" "$f8_exit" "$f8_log"
  fail=$((fail + 1))
fi

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
# ASSERT POSITIONALLY. An earlier version grepped LINES of the argv log, but
# the script text itself spans several lines, so a reversion that interpolated
# the payload onto a line of its OWN evaded both greps and scored green - while
# being provably exploitable. The argv log is one line per ARGUMENT, so the
# structure is what has to be checked: exactly `-e`, a script body carrying no
# payload, `--`, then the message.
h_argc=$(wc -l < "$OSA_ARGV_LOG" 2>/dev/null | tr -d ' ')
h_a1=$(sed -n '1p' "$OSA_ARGV_LOG" 2>/dev/null)
h_script=$(sed -n '2,$p' "$OSA_ARGV_LOG" 2>/dev/null | sed '/^--$/,$d')
h_sep_line=$(grep -nx -- '--' "$OSA_ARGV_LOG" 2>/dev/null | head -1 | cut -d: -f1)
h_msg=$(sed -n "$((${h_sep_line:-0} + 1)),\$p" "$OSA_ARGV_LOG" 2>/dev/null)

if [ "$h_exit" != 1 ]; then
  printf '  FAIL  %-46s exit=%s (expected 1)\n' "H1 hostile filename reaches osascript as DATA" "$h_exit"
  fail=$((fail + 1))
elif [ "$h_a1" != "-e" ] || [ -z "$h_sep_line" ]; then
  printf '  FAIL  %-46s argv shape is not -e <script> -- <msg>: %s\n' "H1 hostile filename reaches osascript as DATA" "$(tr '\n' '|' < "$OSA_ARGV_LOG")"
  fail=$((fail + 1))
elif printf '%s' "$h_script" | grep -q 'do shell script'; then
  printf '  FAIL  %-46s *** payload is INSIDE the script argument ***\n' "H1 hostile filename reaches osascript as DATA"
  fail=$((fail + 1))
elif printf '%s' "$h_msg" | grep -q 'do shell script "id"'; then
  printf '  PASS  %-46s exit=%s (payload only in the data argument)\n' "H1 hostile filename reaches osascript as DATA" "$h_exit"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s payload not found as data: %s\n' "H1 hostile filename reaches osascript as DATA" "$(tr '\n' '|' < "$OSA_ARGV_LOG")"
  fail=$((fail + 1))
fi
printf '#!/bin/sh\nexit 0\n' > "$STUB/osascript"; chmod +x "$STUB/osascript"

# A filename cannot FORGE A LOG ENTRY. zsh's builtin `echo` expands backslash
# escapes, so a name carrying a literal \n injected a whole fabricated line
# into the log, and \c suppressed the trailing newline so the next genuine
# entry fused onto it. Same attacker capability as the osascript injection,
# aimed at the artifact RUNBOOKS tells the operator to read.
rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096
FORGE_NAME='careerforge-db-2026\n2026-08-15 09:00:00 CDT OK: FORGED LINE\c.dump.age'
: > "$BD/$FORGE_NAME"
touch -t "$(date -v-1H '+%Y%m%d%H%M.%S')" "$BD/$FORGE_NAME"
: > "$LOG"
( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" \
    zsh "$REPO/scripts/launchd/careerforge-backup-liveness" >/dev/null 2>&1 )
h2_exit=$?
# Count LOG ENTRIES - lines that begin with a timestamp - not raw lines, and
# not the presence of the forged text. The text legitimately appears INSIDE the
# escaped filename in the one real entry; what must not happen is it becoming
# an entry of its own. (A first cut asserted the text was absent and failed on
# the CORRECT output, which is the plant being wrong rather than the code.)
h2_lines=$(grep -c '^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] ' "$LOG")
if [ "$h2_exit" = 1 ] && [ "$h2_lines" = 1 ]; then
  printf '  PASS  %-46s exit=1, exactly 1 log entry\n' "H2 a filename cannot forge a log entry"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s exit=%s entries=%s log=%s\n' "H2 a filename cannot forge a log entry" "$h2_exit" "$h2_lines" "$(tr '\n' '|' < "$LOG")"
  fail=$((fail + 1))
fi

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
echo "--- GROUP I: the card gate, absent vs wrong vs missing dir (exit 3/1) ---"
# HOW THIS STAYS HERMETIC. The script derives the card volume as the PARENT of
# BACKUP_DIR, which in this harness is $ROOT - so the sentinel it looks for is a
# real file this suite creates and deletes under its own temp dir, and no real
# card is read, written or required. What cannot be faked under a temp dir is
# the MOUNT, so `mount` is stubbed the same way `node` and `osascript` already
# are; the stub prints a mount table in the real format.
#
# The whole group is gated on BACKUP_CARD_ID being set, which is why the 25
# cases above - none of which set it - kept exercising exactly what they were
# written to exercise instead of all turning into CARD_ABSENT.
stub_mount() {  # $1 = a mount point to claim is mounted, or "" for none
  if [ -z "$1" ]; then
    printf '#!/bin/sh\necho "/dev/disk3s5 on / (apfs, local, read-only)"\n' > "$STUB/mount"
  else
    printf '#!/bin/sh\necho "/dev/disk3s5 on / (apfs, local, read-only)"\necho "/dev/disk9s1 on %s (exfat, local, nodev, nosuid, noowners)"\n' "$1" > "$STUB/mount"
  fi
  chmod +x "$STUB/mount"
}
unstub_mount() { rm -f "$STUB/mount"; }

CARD_ID_OK="TEST-CARD-M1610"
SENTINEL="$ROOT/.careerforge-card"

rm -rf "$BD"; write_env "$BD" "BACKUP_CARD_ID=$CARD_ID_OK"; plant_pair "$BD" -2H 4096
rm -f "$SENTINEL"
stub_mount ""
check "I1 card is not mounted" 3 "[CARD_ABSENT]"

# Exit 3 and not 1 is the point of I1: with a healthy dump sitting in a
# perfectly readable directory, the OLD code exited 0 here, and with the
# directory gone it exited 1 exactly as it would for a broken backup. "You took
# the card out" and "your backups are broken" now differ at a glance.

stub_mount "$ROOT"
check "I2 a volume is mounted but carries no sentinel" 3 "[WRONG_CARD]"

printf '%s\n' "SOME-OTHER-CARDS-ID" > "$SENTINEL"
check "I3 sentinel id does not match BACKUP_CARD_ID" 3 "[WRONG_CARD]"

# THE CASE THAT PROVES D3 SEPARATED THE STATES rather than relabelling one.
# Right card, sentinel matching, backup directory gone: that is not a card
# problem, it is a backup problem, and it must still be exit 1 UNREACHABLE.
# This is also why the sentinel lives at the volume root - inside BACKUP_DIR
# this condition and WRONG_CARD are indistinguishable.
printf '%s\n' "$CARD_ID_OK" > "$SENTINEL"
rm -rf "$BD"
check "I4 right card, backup dir missing, is NOT a card fault" 1 "[UNREACHABLE]"

plant_pair "$BD" -2H 4096
check "I5 right card with fresh artifacts is healthy" 0 "OK:"

# The id may arrive in the PROCESS ENVIRONMENT - which is how the LaunchAgent
# supplies it - and the environment must beat a stale .env. Without this, a
# leftover .env value would silently decide which card counts as the backup
# card while the plist looked authoritative.
write_env "$BD" "BACKUP_CARD_ID=A-STALE-ID-IN-DOTENV"
: > "$LOG"
i6_exit="$( cd "$REPO" && env HOME="$FAKE_HOME" PATH="$STUB:$PATH" KURA_CONFIG_DIR="$ROOT/kura-config" \
    BACKUP_CARD_ID="$CARD_ID_OK" \
    zsh "$REPO/scripts/launchd/careerforge-backup-liveness" >/dev/null 2>&1; echo $? )"
i6_log="$(tail -n 1 "$LOG")"
if [ "$i6_exit" = 0 ] && [[ "$i6_log" == *"OK:"* ]]; then
  printf '  PASS  %-46s exit=0  OK:\n' "I6 card id from the ENVIRONMENT beats .env"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s exit=%s log=%s\n' "I6 card id from the ENVIRONMENT beats .env" "$i6_exit" "$i6_log"
  fail=$((fail + 1))
fi

# FAIL CLOSED. A destination under /Volumes is removable media, where "a volume
# is mounted at that path" is not "the backup card is present". With no id the
# gate cannot tell them apart, so it refuses rather than disabling itself.
# Nothing is read: the path does not exist and the refusal happens first.
unstub_mount
write_env "/Volumes/NO-SUCH-CARD-M1610/careerforge-backups"
check "I7 removable destination with no card id is refused" 1 "[ERROR]"

echo
echo "--- GROUP J: the intel leg, through a stub kura (exit 4) ---"
# NO NETWORK, NO REAL kura, NO REAL CONFIG. The stub answers the two commands
# the script runs - `kura intel verify <name...>` and `kura intel status
# <name...>` - from fixture files this suite writes, so every intel state is
# reachable on demand and none of them depends on the intel machine being awake.
#
# These are the cases the SD64 group cannot cover: `kura intel verify` has no
# staleness check of its own, so a leg that stopped being fed passes it
# FOREVER. J2 is the case that proves the freshness rule can actually fire -
# a staleness detector nobody has watched fire is indistinguishable from one
# that cannot.
stub_kura() {  # $1 = verify exit code, $2 = status exit code
  cat > "$STUB/kura" <<KURASTUB
#!/bin/sh
case "\$1 \$2" in
  "intel verify") cat "$ROOT/kura-verify.out"; exit $1 ;;
  "intel status") cat "$ROOT/kura-status.out"; exit $2 ;;
esac
echo "stub kura: unexpected argv: \$*" >&2
exit 99
KURASTUB
  chmod +x "$STUB/kura"
}
unstub_kura() { rm -f "$STUB/kura"; }

PROJ=careerforge-backups
rm -rf "$BD"; write_env "$BD"; plant_pair "$BD" -2H 4096

printf '%s: OK %s-20260902T013622Z.tgz.age\n' "$PROJ" "$PROJ" > "$ROOT/kura-verify.out"
printf '  %-24s 0d old  (%s-20260902T013622Z.tgz.age)\n' "$PROJ" "$PROJ" > "$ROOT/kura-status.out"
stub_kura 0 0
check "J1 intel verified and fresh is healthy" 0 "intel leg: OK" "$PROJ"

# AC(6a): READABLE and INTACT, but no longer being fed. Integrity passes; only
# the age says anything is wrong. Different code path from J3 entirely.
printf '  %-24s 1d old  (%s-20260901T013622Z.tgz.age)\n' "$PROJ" "$PROJ" > "$ROOT/kura-status.out"
check "J2 intel STALE but readable (AC 6a)" 4 "[INTEL_STALE]" "$PROJ"

printf '  %-24s never backed up\n' "$PROJ" > "$ROOT/kura-status.out"
check "J3 a project never pushed to intel" 4 "[INTEL_STALE]" "$PROJ"

printf '%s: CHECKSUM FAIL %s-20260902T013622Z.tgz.age\n' "$PROJ" "$PROJ" > "$ROOT/kura-verify.out"
printf '  %-24s 0d old  (%s-20260902T013622Z.tgz.age)\n' "$PROJ" "$PROJ" > "$ROOT/kura-status.out"
stub_kura 1 0
check "J4 intel integrity failure is DEGRADED" 4 "[INTEL_DEGRADED]" "$PROJ"

printf 'kura: intel (intel) not reachable\n' > "$ROOT/kura-verify.out"
check "J5 intel unreachable is its own state" 4 "[INTEL_UNREACHABLE]" "$PROJ"

# FAIL CLOSED on output this check cannot read. If kura's status format ever
# changes, an unparsed leg must not read as a healthy one - that is the defect
# class this whole story exists to prevent, and it would arrive silently.
printf '%s: OK %s-20260902T013622Z.tgz.age\n' "$PROJ" "$PROJ" > "$ROOT/kura-verify.out"
printf 'intel (intel): reachable\nsome format nobody parsed\n' > "$ROOT/kura-status.out"
stub_kura 0 0
check "J6 unparseable status is UNCHECKABLE, not OK" 4 "[INTEL_UNCHECKABLE]" "$PROJ"

# NEITHER LEG MASKS THE OTHER. The card is gone AND the intel leg is stale.
# The alert names the card (the cause), and the intel state rides on the same
# line instead of being lost behind the first exit.
printf '  %-24s 3d old  (%s-20260830T013622Z.tgz.age)\n' "$PROJ" "$PROJ" > "$ROOT/kura-status.out"
write_env "$BD" "BACKUP_CARD_ID=$CARD_ID_OK"
rm -f "$SENTINEL"
stub_mount ""
check "J7 card fault alerts, intel state still reported" 3 "[CARD_ABSENT]" "$PROJ"
: > "$LOG"
run_script "$PROJ" >/dev/null
j8_log="$(tail -n 1 "$LOG")"
if [[ "$j8_log" == *"[CARD_ABSENT]"* ]] && [[ "$j8_log" == *"intel leg: STALE"* ]]; then
  printf '  PASS  %-46s both legs on one line\n' "J8 the card alert carries the intel verdict"
  pass=$((pass + 1))
else
  printf '  FAIL  %-46s log=%s\n' "J8 the card alert carries the intel verdict" "$j8_log"
  fail=$((fail + 1))
fi

unstub_kura
unstub_mount

echo
echo "=== RESULT: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]

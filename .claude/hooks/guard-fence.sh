#!/usr/bin/env bash
# PreToolUse guard (matcher "*"): the fence. It stops WORK, not just writes.
#
# A seat that has been reaped keeps running until something tells it to stop.
# Bumping generations/<seat> is that something, and this hook is the only place
# a session finds out. On every tool call it asks one question: does the live
# claim in the state root still belong to THIS session at the CURRENT
# generation? If not, every tool is denied with an instruction to stop.
#
# It also heartbeats. The touch of live/<seat> is not done here by hand - it is
# done by calling `seat heartbeat`, which is the same code path `seat` uses
# everywhere else. Two implementations of one write discipline is how the two
# drift apart, and the drift would only surface as a phantom reap.
#
# ---------------------------------------------------------------------------
# FAIL MODES, stated because a guard whose limits are unclear gets trusted past
# them (contract "Guard hooks" + design r4 amendment B):
#
#   ALLOW + warn  - state root unreachable (mount gone, EIO). A broken mount
#                   must not brick interactive work; fleetd's tripwire and the
#                   unknown-spawn_id rejection cover the gap.
#   ALLOW         - no .claude/seat in this clone. Unmanaged clone, not our
#                   business.
#   ALLOW         - claim absent AND the tool is read-only. A session that has
#                   not claimed yet still needs to read its way to a claim.
#   DENY (exit 2) - claim absent and the tool mutates.
#   DENY (exit 2) - generation mismatch, session mismatch, or an owner.json
#                   that is present but unparseable. Root readable + required
#                   file wrong is NOT the same as root unreachable.
#   DENY (exit 2) - state root READABLE but bin/seat absent or not executable,
#                   for mutating tools (read-only still allowed). That is a
#                   broken deploy, not an unreachable mount, and design r4
#                   amendment B puts "root readable + required file absent" on
#                   the deny side.
#
# A hook TIMEOUT is fail-open by harness design; that is why the whole thing is
# two file reads and one short-lived python process, well under 2s.
#
# Exit 2 blocks the tool call. Every other exit code allows it.
# ---------------------------------------------------------------------------
set -uo pipefail

warn() { echo "guard-fence.sh: $*" >&2; }

# --- clone-relative identity ------------------------------------------------
# Derived from $0 rather than $PWD so the hook works from any cwd, and so a
# synced copy in another clone answers for THAT clone.
HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || HOOK_DIR=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  CLONE="$CLAUDE_PROJECT_DIR"
elif [ -n "$HOOK_DIR" ]; then
  CLONE="$(cd "$HOOK_DIR/../.." 2>/dev/null && pwd)" || CLONE=""
else
  CLONE=""
fi
[ -n "$CLONE" ] || exit 0

SEAT_FILE="$CLONE/.claude/seat"
[ -f "$SEAT_FILE" ] || exit 0                       # unmanaged clone
SEAT="$(head -n 1 "$SEAT_FILE" 2>/dev/null | tr -d '[:space:]')" || SEAT=""
[ -n "$SEAT" ] || exit 0

# --- state root -------------------------------------------------------------
if [ -n "${CF_STATE_ROOT:-}" ]; then
  STATE_ROOT="$CF_STATE_ROOT"
elif [ -d /Users/carlos/careerforge-state ]; then
  STATE_ROOT=/Users/carlos/careerforge-state
elif [ -d /home/node/careerforge-state ]; then
  STATE_ROOT=/home/node/careerforge-state
else
  STATE_ROOT=""
fi
# An override that points at nothing is the SAME case as a missing mount, and
# it has to be told apart from a root that IS there with its CLI missing (that
# one denies, below). Checking only the two default spellings for existence
# left CF_STATE_ROOT unvalidated, so a stale override read as "broken deploy".
if [ -z "$STATE_ROOT" ] || [ ! -d "$STATE_ROOT" ]; then
  warn "state root ${STATE_ROOT:-(none of the known spellings)} unreachable; ALLOWING this call (fleetd tripwire covers it)."
  exit 0
fi
SEAT_CLI="$STATE_ROOT/bin/seat"

# --- payload ----------------------------------------------------------------
# jq is present on the host and in every seat container. When it is not, the
# fallback is python3 (already a hard dependency of the seat CLI itself) rather
# than "read nothing": without tool_name and session_id this hook cannot apply
# the read-only carve-out OR prove identity, and every call would be denied.
TOOL=""
SESSION_ID=""
BASH_CMD=""
input="$(cat)" || input=""
if [ -n "$input" ]; then
  if command -v jq >/dev/null 2>&1; then
    TOOL="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || TOOL=""
    SESSION_ID="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)" || SESSION_ID=""
    BASH_CMD="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || BASH_CMD=""
  elif command -v python3 >/dev/null 2>&1; then
    # One process, three values, one line each. tool_name and session_id are
    # newline-stripped so a crafted payload cannot forge a field boundary; the
    # command comes LAST and keeps its newlines (they are exactly what the
    # early-allow below has to see), behind a one-character marker so an empty
    # command cannot collapse the field count.
    parsed="$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
if not isinstance(data, dict):
    data = {}
tool_input = data.get("tool_input")
if not isinstance(tool_input, dict):
    tool_input = {}

def text(value):
    return value if isinstance(value, str) else ""

sys.stdout.write(text(data.get("tool_name")).replace("\n", " ") + "\n")
sys.stdout.write(text(data.get("session_id")).replace("\n", " ") + "\n")
sys.stdout.write("C" + text(tool_input.get("command")))
' 2>/dev/null)" || parsed=""
    if [ -n "$parsed" ]; then
      TOOL="${parsed%%$'\n'*}"
      rest="${parsed#*$'\n'}"
      SESSION_ID="${rest%%$'\n'*}"
      BASH_CMD="${rest#*$'\n'}"
      BASH_CMD="${BASH_CMD#C}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# The canonical seat-CLI invocation is ALWAYS allowed, claimed or not: the CLI
# enforces its own claim/fence semantics (exit 3/4), and without this
# carve-out an unclaimed session is deadlocked - the fence blocks the very
# `seat claim` it instructs you to run (found live, 2026-08-17 V3 probe).
#
# It allows ONE SIMPLE COMMAND and nothing else. A prefix match on
# "<canon> " was a universal bypass of this hook and of guard-bus-writes:
# `<canon> --help; anything`, `<canon> x` + newline + anything, and
# `<canon> status > /ops/DISPATCH.md` all start with the canonical path.
# So: no shell control or substitution character may appear ANYWHERE in the
# command - ; & | < > ` $ ( ) or a newline - and argv[0] must be the pinned
# path itself. Anything else falls through to the full analysis below, which
# is the safe direction: `seat` still runs, it just gets checked first.
# The pinned strings are asserted by scripts/claude-hooks.test.mjs.
# ---------------------------------------------------------------------------
CANON_HOST_SEAT="/Users/carlos/careerforge-state/bin/seat"
CANON_CONTAINER_SEAT="/home/node/careerforge-state/bin/seat"

is_lone_seat_cmd() {
  # $1 = the command string; $2.. = allowed argv[0] glob patterns.
  _cmd="$1"
  shift
  case "$_cmd" in
    *';'*|*'&'*|*'|'*|*'<'*|*'>'*|*'`'*|*'$'*|*'('*|*')'*) return 1 ;;
  esac
  case "$_cmd" in
    *$'\n'*) return 1 ;;
  esac
  _argv0="${_cmd%% *}"
  for _pattern in "$@"; do
    # Unquoted on purpose: these patterns are globs, not literals.
    case "$_argv0" in
      $_pattern) return 0 ;;
    esac
  done
  return 1
}

if [ "$TOOL" = "Bash" ] && is_lone_seat_cmd "$BASH_CMD" \
     "$CANON_HOST_SEAT" "$CANON_CONTAINER_SEAT"; then
  exit 0
fi

# Read-only tools stay allowed while a clone is merely unclaimed (contract:
# Read/Grep/Glob/ListAgents/TaskList/status). They are NOT allowed once the
# seat is fenced - a fenced session must stop, not keep reading.
is_read_only() {
  case "$1" in
    Read|Grep|Glob|ListAgents|TaskList|TodoRead) return 0 ;;
    *) return 1 ;;
  esac
}

# The state root resolved, so this is not an unreachable mount - it is a
# deploy with its CLI missing. Amendment B: readable root + required file
# absent DENIES (mutating tools only; reading your way out stays possible).
if [ ! -x "$SEAT_CLI" ]; then
  if is_read_only "$TOOL"; then
    warn "$SEAT_CLI missing or not executable under a READABLE state root; allowing read-only $TOOL."
    exit 0
  fi
  echo "BLOCKED by .claude/hooks/guard-fence.sh: $SEAT_CLI is missing or not executable." >&2
  echo "  The state root at $STATE_ROOT IS readable, so this is a broken deploy," >&2
  echo "  not an unreachable mount. Tenure cannot be verified; failing CLOSED." >&2
  exit 2
fi

# --- the one question -------------------------------------------------------
# `set -e` is deliberately never enabled in this file: a nonzero rc here is
# the signal, not a failure.
#
# --bind is the other half of the interactive identity story. `seat claim
# --interactive` cannot know its own session id - the harness does not put it
# in the Bash environment - so it records the INTERACTIVE placeholder, which
# matches every session in the clone. This hook holds the ONLY copy of the real
# id, so it hands it over on the first tool call and the CLI swaps the
# placeholder for it atomically. From that moment identity is real: a second
# session in the same clone stops matching, and only the bound session can
# release the tenure.
#
# No session_id in the payload => --no-touch. Verify tenure, but do NOT stamp
# live/<seat>: liveness that cannot be attributed to a session is exactly the
# false signal that keeps a dead seat looking alive to fleetd's reaper.
if [ -n "$SESSION_ID" ]; then
  hb_err="$("$SEAT_CLI" heartbeat --seat "$SEAT" --session-id "$SESSION_ID" --bind --quiet 2>&1)"
else
  hb_err="$("$SEAT_CLI" heartbeat --seat "$SEAT" --no-touch --quiet 2>&1)"
fi
rc=$?

case "$rc" in
  0)
    exit 0
    ;;
  6)
    warn "state root unreachable from the CLI; ALLOWING this call."
    exit 0
    ;;
  4)
    reason="$(printf '%s' "$hb_err" | head -n 1)"
    case "$reason" in
      *no-claim*)
        if is_read_only "$TOOL"; then
          exit 0
        fi
        echo "BLOCKED by .claude/hooks/guard-fence.sh: seat '$SEAT' has NO live claim." >&2
        echo "  Mutating tools are denied until this session holds the seat." >&2
        echo "  Run: $SEAT_CLI claim --seat $SEAT --interactive   (or wait for fleetd)." >&2
        exit 2
        ;;
      *)
        # The CLI already prints the full stop instruction; repeating it here
        # would only make the important line harder to find.
        echo "BLOCKED by .claude/hooks/guard-fence.sh: every tool is denied for seat '$SEAT'." >&2
        printf '%s\n' "$hb_err" | sed 's/^/  /' >&2
        exit 2
        ;;
    esac
    ;;
  *)
    # Root readable but the claim state is refused/inconsistent (exit 2 or 5).
    # Fail CLOSED: an ambiguous fence is the case this hook exists for.
    echo "BLOCKED by .claude/hooks/guard-fence.sh: claim state for '$SEAT' is unusable (seat exit $rc)." >&2
    printf '%s\n' "$hb_err" | sed 's/^/  /' >&2
    echo "  Failing CLOSED rather than working on a seat whose ownership is unknown." >&2
    exit 2
    ;;
esac

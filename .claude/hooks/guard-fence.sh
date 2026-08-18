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
#   ALLOW + warn  - state root unreachable (mount gone, EIO, no bin/seat).
#                   A broken mount must not brick interactive work; fleetd's
#                   tripwire and the unknown-spawn_id rejection cover the gap.
#   ALLOW         - no .claude/seat in this clone. Unmanaged clone, not our
#                   business.
#   ALLOW         - claim absent AND the tool is read-only. A session that has
#                   not claimed yet still needs to read its way to a claim.
#   DENY (exit 2) - claim absent and the tool mutates.
#   DENY (exit 2) - generation mismatch, session mismatch, or an owner.json
#                   that is present but unparseable. Root readable + required
#                   file wrong is NOT the same as root unreachable.
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
  warn "state root unreachable; ALLOWING this call (fleetd tripwire covers it)."
  exit 0
fi
SEAT_CLI="$STATE_ROOT/bin/seat"
if [ ! -x "$SEAT_CLI" ]; then
  warn "$SEAT_CLI missing or not executable; ALLOWING (a guard bug must not stop the fleet)."
  exit 0
fi

# --- payload ----------------------------------------------------------------
# jq is present on the host and in every seat container. Without it we cannot
# read tool_name, and denying every call over a missing jq would be worse than
# the residual it protects, so the read-only carve-out simply cannot apply.
TOOL=""
SESSION_ID=""
BASH_CMD=""
if command -v jq >/dev/null 2>&1; then
  input="$(cat)" || input=""
  if [ -n "$input" ]; then
    TOOL="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || TOOL=""
    SESSION_ID="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)" || SESSION_ID=""
    BASH_CMD="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || BASH_CMD=""
  fi
else
  cat >/dev/null 2>&1 || true
fi

# The canonical seat-CLI invocation is ALWAYS allowed, claimed or not: the CLI
# enforces its own claim/fence semantics (exit 3/4), and without this
# carve-out an unclaimed session is deadlocked - the fence blocks the very
# `seat claim` it instructs you to run (found live, 2026-08-17 V3 probe).
case "$BASH_CMD" in
  /Users/carlos/careerforge-state/bin/seat\ *|/home/node/careerforge-state/bin/seat\ *)
    [ "$TOOL" = "Bash" ] && exit 0
    ;;
esac

# Read-only tools stay allowed while a clone is merely unclaimed (contract:
# Read/Grep/Glob/ListAgents/TaskList/status). They are NOT allowed once the
# seat is fenced - a fenced session must stop, not keep reading.
is_read_only() {
  case "$1" in
    Read|Grep|Glob|ListAgents|TaskList|TodoRead) return 0 ;;
    *) return 1 ;;
  esac
}

# --- the one question -------------------------------------------------------
# `set -e` is deliberately never enabled in this file: a nonzero rc here is
# the signal, not a failure.
if [ -n "$SESSION_ID" ]; then
  hb_err="$("$SEAT_CLI" heartbeat --seat "$SEAT" --session-id "$SESSION_ID" --quiet 2>&1)"
else
  hb_err="$("$SEAT_CLI" heartbeat --seat "$SEAT" --quiet 2>&1)"
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

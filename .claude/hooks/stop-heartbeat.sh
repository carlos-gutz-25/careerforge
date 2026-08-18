#!/usr/bin/env bash
# Stop hook: heartbeat the seat at the end of every turn.
#
# ALWAYS EXITS 0. This is not defensive habit, it is a harness contract: a Stop
# hook that exits 2 forcibly CONTINUES the turn, so a heartbeat failure here
# would turn a missing mount into an agent that cannot stop talking. Every
# failure mode below is therefore swallowed.
#
# The long-turn case is covered elsewhere - guard-fence.sh touches live/<seat>
# on every allowed tool call, and interactive tenures hold a 4h lease.
set -uo pipefail

if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  CLONE="$CLAUDE_PROJECT_DIR"
else
  CLONE="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || CLONE=""
fi
[ -n "$CLONE" ] || exit 0

SEAT="$(head -n 1 "$CLONE/.claude/seat" 2>/dev/null | tr -d '[:space:]')" || SEAT=""
[ -n "$SEAT" ] || exit 0

if [ -n "${CF_STATE_ROOT:-}" ]; then
  STATE_ROOT="$CF_STATE_ROOT"
elif [ -d /Users/carlos/careerforge-state ]; then
  STATE_ROOT=/Users/carlos/careerforge-state
elif [ -d /home/node/careerforge-state ]; then
  STATE_ROOT=/home/node/careerforge-state
else
  exit 0
fi
[ -x "$STATE_ROOT/bin/seat" ] || exit 0

SESSION_ID=""
payload="$(cat 2>/dev/null)" || payload=""
if [ -n "$payload" ]; then
  if command -v jq >/dev/null 2>&1; then
    SESSION_ID="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
  elif command -v python3 >/dev/null 2>&1; then
    SESSION_ID="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
value = data.get("session_id") if isinstance(data, dict) else None
sys.stdout.write(value.replace("\n", " ") if isinstance(value, str) else "")
' 2>/dev/null)" || SESSION_ID=""
  fi
fi

# No session id in the payload means this turn cannot be attributed to the
# session that holds the seat - so there is nothing to heartbeat ABOUT.
# Stamping live/<seat> anyway would tell fleetd's reaper that whoever holds
# this seat is alive, on the word of a caller that cannot name itself. Doing
# nothing is the honest answer; the lease TTL then decides.
[ -n "$SESSION_ID" ] || exit 0

"$STATE_ROOT/bin/seat" heartbeat --seat "$SEAT" --session-id "$SESSION_ID" --quiet >/dev/null 2>&1

exit 0

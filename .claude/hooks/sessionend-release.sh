#!/usr/bin/env bash
# SessionEnd hook: hand an INTERACTIVE tenure back when the human leaves.
#
# `--if-interactive` is the whole point. Task tenures are released by fleetd at
# the spawn's terminal state, because a task session's SessionEnd fires between
# every --resume leg - releasing there would leave each continuation running
# with no claim at all, which the fence would then (correctly) shut down.
#
# ALWAYS EXITS 0. A session that is already fenced, already released, or facing
# an unreachable state root has nothing useful to do here; fleetd reconciles
# any claim left behind.
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

# Releasing ends a tenure, so it takes proof of ownership - and the payload's
# session_id is the only proof this hook has. Without one there is nothing to
# prove and nothing to do: SessionEnd fires for EVERY session in a clone, and
# the second one must never be able to hand back the first one's seat. An
# unbound interactive claim (one whose session never made a tool call, so the
# fence guard never bound it) is refused by the CLI for the same reason;
# fleetd's lease TTL reaps it instead.
[ -n "$SESSION_ID" ] || exit 0

"$STATE_ROOT/bin/seat" release --if-interactive --seat "$SEAT" \
  --session-id "$SESSION_ID" --quiet >/dev/null 2>&1

exit 0

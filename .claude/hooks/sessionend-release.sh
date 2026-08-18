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
if command -v jq >/dev/null 2>&1; then
  payload="$(cat 2>/dev/null)" || payload=""
  [ -n "$payload" ] && SESSION_ID="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
else
  cat >/dev/null 2>&1 || true
fi

if [ -n "$SESSION_ID" ]; then
  "$STATE_ROOT/bin/seat" release --if-interactive --seat "$SEAT" \
    --session-id "$SESSION_ID" --quiet >/dev/null 2>&1
else
  "$STATE_ROOT/bin/seat" release --if-interactive --seat "$SEAT" --quiet >/dev/null 2>&1
fi

exit 0

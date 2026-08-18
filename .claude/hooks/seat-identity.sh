#!/usr/bin/env bash
# seat-identity.sh - SessionStart(startup) identity printout for seat clones.
# A session that boots into nothing should say so on line one instead of
# sitting silent (the "agents that do nothing" failure class, 2026-08-17).
# Prints to stdout (added to context). ALWAYS exits 0: identity is
# information, never a gate - the gates are guard-fence and the seat CLI.
set -u

CLONE="${CLAUDE_PROJECT_DIR:-$(pwd)}"

state_root=""
for r in "${CF_STATE_ROOT:-}" /Users/carlos/careerforge-state /home/node/careerforge-state; do
  [ -n "$r" ] && [ -d "$r" ] && { state_root="$r"; break; }
done
ops_root=""
for r in "${CF_OPS_ROOT:-}" /Users/carlos/careerforge-v2-ops /home/node/careerforge-v2-ops; do
  [ -n "$r" ] && [ -d "$r" ] && { ops_root="$r"; break; }
done

seat="(unmanaged clone - no .claude/seat)"
[ -f "$CLONE/.claude/seat" ] && seat="$(head -1 "$CLONE/.claude/seat" 2>/dev/null)"

head_line="$(git -C "$CLONE" log --oneline -1 2>/dev/null || echo 'no git')"
behind=""
if git -C "$CLONE" rev-parse origin/main >/dev/null 2>&1; then
  behind="$(git -C "$CLONE" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
fi

claim="none"
gen="?"
if [ -n "$state_root" ] && [ -n "$seat" ] && [ -f "$state_root/claims/$seat/owner.json" ]; then
  claim="held ($(head -c 200 "$state_root/claims/$seat/owner.json" 2>/dev/null | tr -d '\n'))"
fi
[ -n "$state_root" ] && [ -f "$state_root/generations/$seat" ] && gen="$(head -1 "$state_root/generations/$seat")"

echo "[seat-identity] seat: $seat"
echo "[seat-identity] clone: $CLONE"
echo "[seat-identity] HEAD: $head_line${behind:+ (behind origin/main by $behind)}"
echo "[seat-identity] state root: ${state_root:-UNREACHABLE} | ops root: ${ops_root:-UNREACHABLE}"
echo "[seat-identity] claim: $claim | generation: $gen"
echo "[seat-identity] next: run /boot to claim the seat and take work"
exit 0

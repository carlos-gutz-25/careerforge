#!/usr/bin/env bash
# PostToolUse guard: a coordination-bus file must end with a newline.
#
# The bus is append-only (PROTOCOL-CORE rule 3). A file left without a trailing
# newline makes the NEXT lane's append fuse onto the previous line, corrupting
# two entries at once and usually going unnoticed until someone greps.
#
# MOVED HERE 2026-08-15 from an untracked settings.local.json. It previously
# existed only as an inline jq one-liner in per-clone local settings, which
# meant: not reviewed, not shared, and absent from any fresh clone. The only
# hook in the whole apparatus lived somewhere no reviewer would ever see it.
#
# PORTABILITY FIX applied in the move: the old version hardcoded
# /Users/carlos/careerforge-v2-ops and needed a second registration for the
# in-container /home/node/... path. Matching on the */careerforge-v2-ops/*
# path SEGMENT covers both, needs one registration, and keeps a home directory
# out of a public repository.
#
# Exit 2 surfaces the problem to Claude so it fixes the file before continuing.
set -euo pipefail

input="$(cat)"
f="$(printf '%s' "$input" | jq -r '(.tool_input.file_path // .tool_response.filePath) // empty' 2>/dev/null || true)"
[ -z "$f" ] && exit 0

# Any file under the ops directory, on any host or container mount point.
# NOTE the scope honestly: this is every file in careerforge-v2-ops, not
# only the lane bus files. That is deliberate - a truncated notes/ or
# reviews/ file is just as bad - but the comment used to say "only bus
# files", which was wrong.
case "$f" in
  */careerforge-v2-ops/*) ;;
  *) exit 0 ;;
esac

# A file that does not exist or is empty cannot be missing a trailing newline.
[ -f "$f" ] || exit 0
[ -s "$f" ] || exit 0

# tail -c 1 yields empty when the last byte IS a newline.
if [ -n "$(tail -c 1 "$f")" ]; then
  echo "PROTOCOL defensive-newline (rule 3): $f was left WITHOUT a trailing newline." >&2
  echo "The next lane's append would fuse onto your last line." >&2
  echo "NOTE: PostToolUse fires AFTER the write, so the file is ALREADY on disk." >&2
  echo "This is advisory, not prevention: append the newline now, then re-read" >&2
  echo "(tail -n 3) and confirm your entry stands alone." >&2
  exit 2
fi

exit 0

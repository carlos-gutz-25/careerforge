#!/usr/bin/env bash
# init-seat-worktrees.sh - create the five container seats as git worktrees.
#
# RUN THIS ON THE HOST, BEFORE `devcontainer up`. Not because the container
# cannot do it, but because compose mounts a node_modules volume into every
# package directory of every seat: if a seat directory does not exist yet,
# docker creates it (and the node_modules skeleton inside it) root-owned, and
# `git worktree add` then refuses the path for being non-empty. Order matters
# exactly once - after that this script is a no-op.
#
# Each seat is a DETACHED worktree at the current main tip. Detached, not on a
# branch, on purpose: a seat picks up its own branch when it takes work, and a
# named branch here would just be a fifth thing to keep in sync. It also means
# five seats can sit on the same commit, which two branches of the same name
# could not.
#
# Each seat is seeded with an untracked .claude/seat file naming it. That file
# is what .claude/hooks/seat-identity.sh reads to announce which seat a session
# booted into; it is gitignored (the root .gitignore's `/.claude/*` deny, with
# no re-include for it), so it never rides along on a commit. settings.json and
# the hooks ARE tracked, so every worktree inherits them from the checkout.
#
# Idempotent: an existing seat is left completely alone - no re-checkout, no
# reset, no touching a dirty tree or in-flight work.
set -euo pipefail

MAIN="${CF_MAIN:-/Users/carlos/code/careerforge}"
WORKTREES="${CF_WORKTREES:-/Users/carlos/code/careerforge-worktrees}"

# The five container seats. Keep in lockstep with gen-seat-volumes.sh's SEATS
# array - a seat without its nm-* volumes would install node_modules straight
# into the host tree.
SEATS=(a1-resume a2-coaching b1-portfolio b2-web review-seat)

die() { echo "init-seat-worktrees: $*" >&2; exit 1; }

[ -d "$MAIN/.git" ] || die "$MAIN is not a git checkout"
mkdir -p "$WORKTREES"

# One base commit for the whole batch, so a batch created in one run is
# self-consistent even if something lands on main mid-run.
BASE="$(git -C "$MAIN" rev-parse HEAD)"
echo "init-seat-worktrees: base $BASE ($(git -C "$MAIN" rev-parse --abbrev-ref HEAD))"

created=0
skipped=0
for seat in "${SEATS[@]}"; do
    path="$WORKTREES/$seat"

    if [ -e "$path" ]; then
        # Registered worktree -> nothing to do. Anything else at that path is
        # an operator problem, not something to silently overwrite.
        if git -C "$MAIN" worktree list --porcelain | grep -qxF "worktree $path"; then
            echo "  skip    $seat (worktree exists)"
            skipped=$((skipped + 1))
        else
            die "$path exists but is not a registered worktree - resolve by hand"
        fi
    else
        git -C "$MAIN" worktree add --detach "$path" "$BASE" >/dev/null
        echo "  create  $seat -> $path"
        created=$((created + 1))
    fi

    # Seed (or repair) the identity file. Cheap, idempotent, and the one thing
    # worth re-asserting on an existing seat: a worktree whose .claude/seat went
    # missing boots as "unmanaged clone" and the session silently has no seat.
    mkdir -p "$path/.claude"
    if [ ! -f "$path/.claude/seat" ] || [ "$(head -1 "$path/.claude/seat")" != "$seat" ]; then
        printf '%s\n' "$seat" > "$path/.claude/seat"
        echo "          seeded .claude/seat"
    fi
    git -C "$path" check-ignore -q .claude/seat \
        || die "$path/.claude/seat is NOT gitignored - refusing to leave a committable seat marker"
done

echo "init-seat-worktrees: $created created, $skipped already present"
git -C "$MAIN" worktree list

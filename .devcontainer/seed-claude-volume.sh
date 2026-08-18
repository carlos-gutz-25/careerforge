#!/usr/bin/env bash
# seed-claude-volume.sh - give one seat its OWN Claude config volume, seeded
# from the fleet's old shared one.
#
# RUNS ON THE HOST, never inside a seat (it talks to the docker socket, which
# is deliberately absent from every container).
#
# Why it exists: compose.devcontainer.yml used to pin `name:
# careerforge-claude-config` on the claude-config volume, so all six seats
# mounted ONE volume - one .claude.json rewritten by six containers, one
# history.jsonl, pooled transcripts. That pin is gone, so compose now creates
# a per-project <project>_claude-config volume, which starts EMPTY: no
# credential, no settings, no statusline. This copies the small set of files
# that must carry over, using a throwaway alpine container because a docker
# volume has no host path worth touching on Colima.
#
# What it copies (and nothing else, on purpose):
#   .credentials.json       the sign-in - without it the seat asks to log in
#   settings.json           the seat's Claude Code settings
#   statusline-command.sh   referenced by settings.json; a missing file makes
#                           every prompt print a statusline error
#   CLAUDE.md               only if the source volume has one
#
# What it does NOT copy, and why: .claude.json (46KB of pooled project state,
# history and onboarding flags from all six seats - copying it would re-pool
# exactly what this change separates), projects/, sessions/, history.jsonl,
# file-history/, todos/. A freshly seeded seat therefore starts with an empty
# transcript history, which is the point, and may re-show first-run prompts
# (theme, trust) once.
#
# Usage:
#   seed-claude-volume.sh <project> [<project>...]
#   seed-claude-volume.sh --all           every seat in the default fleet list
#   FORCE=1 seed-claude-volume.sh <project>   overwrite an already-seeded volume
#
# <project> is the COMPOSE PROJECT NAME, which is the seat clone's directory
# basename: careerforge-review, cf-a1-resume, cf-a2-coaching, cf-b1-portfolio,
# cf-b2-web, cf-dispatcher.
#
# Idempotent: a target that already holds .credentials.json is left untouched
# unless FORCE=1. Safe to run while the fleet is up, but the seats will not see
# the new volume until they are recreated.
set -euo pipefail

OLD_VOLUME="${OLD_VOLUME:-careerforge-claude-config}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:latest}"
FLEET=(careerforge-review cf-a1-resume cf-a2-coaching cf-b1-portfolio cf-b2-web cf-dispatcher)
# uid:gid of the `node` user inside the devcontainer image.
NODE_UID=1000
NODE_GID=1000

die() { echo "seed-claude-volume: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found (this script runs on the HOST)"

[ $# -gt 0 ] || die "usage: seed-claude-volume.sh <project> [<project>...] | --all"
if [ "$1" = "--all" ]; then
    [ $# -eq 1 ] || die "--all takes no other arguments"
    set -- "${FLEET[@]}"
fi

# --- refuse early if the source is not a usable donor -----------------------
docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1 \
    || die "source volume '$OLD_VOLUME' does not exist - nothing to seed from"

if ! docker run --rm -v "$OLD_VOLUME:/old:ro" "$HELPER_IMAGE" \
        test -f /old/.credentials.json; then
    die "source volume '$OLD_VOLUME' has no .credentials.json - refusing to seed
    a fleet with volumes that cannot sign in. Sign in once in any seat that
    still mounts it, then re-run."
fi

echo "source: $OLD_VOLUME (has .credentials.json)"

rc=0
for project in "$@"; do
    case "$project" in
        -*) die "not a project name: '$project'" ;;
    esac
    new="${project}_claude-config"

    if docker volume inspect "$new" >/dev/null 2>&1; then
        echo "== $project -> $new (exists)"
    else
        docker volume create "$new" >/dev/null
        echo "== $project -> $new (created)"
    fi

    # Idempotency keys on a .seeded SENTINEL written LAST, after the chown -
    # not on .credentials.json which is written FIRST. A seed that crashed or
    # OOMed between the first cp and the final chown leaves a root-owned mount
    # with a credential in it; keying on .credentials.json would call that
    # "already seeded" and the seat would boot unable to write /home/node/.claude
    # (proven by the PR #219 fleet review). The sentinel exists only when the
    # whole copy AND the chown completed.
    if [ "${FORCE:-0}" != "1" ] \
       && docker run --rm -v "$new:/new:ro" "$HELPER_IMAGE" \
            test -f /new/.seeded; then
        echo "   already seeded (.seeded sentinel present) - skipping. FORCE=1 to overwrite."
        continue
    fi

    # One throwaway container does the whole copy: -p keeps the credential's
    # 0600 mode, and the chown makes the files readable by `node` in the seat
    # (a volume created by `docker volume create` is root-owned). The .seeded
    # sentinel is the LAST write, so its presence proves the chown ran.
    if docker run --rm \
        -v "$OLD_VOLUME:/old:ro" \
        -v "$new:/new" \
        -e NODE_UID="$NODE_UID" -e NODE_GID="$NODE_GID" \
        "$HELPER_IMAGE" sh -eu -c '
            rm -f /new/.seeded
            copied=""
            for f in .credentials.json settings.json statusline-command.sh CLAUDE.md; do
                if [ -f "/old/$f" ]; then
                    cp -p "/old/$f" "/new/$f"
                    copied="$copied $f"
                fi
            done
            chown -R "$NODE_UID:$NODE_GID" /new
            date -u +%Y-%m-%dT%H:%M:%SZ > /new/.seeded
            chown "$NODE_UID:$NODE_GID" /new/.seeded
            echo "   copied:$copied"
        '
    then
        :
    else
        echo "   FAILED to seed $new" >&2
        rc=1
    fi
done

if [ "$rc" -ne 0 ]; then
    echo "seed-claude-volume: one or more seats failed" >&2
fi
exit "$rc"

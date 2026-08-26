#!/usr/bin/env bash
# gen-seat-volumes.sh - deterministic generator for the per-seat node_modules
# shadowing blocks in compose.devcontainer.yml.
#
# WHY A GENERATOR AND A CHECKED-IN FILE, BOTH. Five seats x ten workspace
# packages is fifty mount lines plus fifty volume declarations; hand-editing
# that on every seat or package change is how a single typo becomes an hour of
# "why is this seat installing into the host tree". But compose must NEVER
# depend on running this: `devcontainer up` and a bare `docker compose up` both
# read compose.devcontainer.yml as it sits on disk. So the generated text is
# COMMITTED, and this script is the thing that rewrites it in place.
#
# Usage:
#   gen-seat-volumes.sh            emit both blocks to stdout (inspection)
#   gen-seat-volumes.sh --write    splice both blocks into compose.devcontainer.yml
#   gen-seat-volumes.sh --check    exit 1 if the committed file is out of date
#
# Adding a seat or a workspace package = edit the two arrays below, run
# --write, commit the diff. --check is the drift gate.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$HERE/compose.devcontainer.yml"

# Container-side root of the seat worktrees. Host-identical absolute path (see
# the header of compose.devcontainer.yml for why the paths must match).
WORKTREE_ROOT=/Users/carlos/code/careerforge-worktrees

# The five container seats. Order is the emitted order - keep it stable so the
# generated diff stays reviewable.
SEATS=(a1-resume a2-coaching b1-portfolio b2-web review-seat)

# Every workspace package that gets its own node_modules, as
# "<volume-suffix>:<path-under-the-worktree>". "root" is the repo root itself
# and is spelled with an empty path. Mirrors the main tree's nm-* set exactly;
# derived from pnpm-workspace.yaml (apps/*, packages/*).
PKGS=(
  "root:"
  "apps-api:/apps/api"
  "apps-portfolio:/apps/portfolio"
  "apps-web:/apps/web"
  "packages-config:/packages/config"
  "packages-core:/packages/core"
  "packages-db:/packages/db"
  "packages-llm:/packages/llm"
  "packages-resume-render:/packages/resume-render"
  "packages-scoring:/packages/scoring"
)

MOUNTS_BEGIN='      # >>> BEGIN GENERATED seat node_modules mounts (gen-seat-volumes.sh) >>>'
MOUNTS_END='      # <<< END GENERATED seat node_modules mounts <<<'
VOLS_BEGIN='  # >>> BEGIN GENERATED seat node_modules volumes (gen-seat-volumes.sh) >>>'
VOLS_END='  # <<< END GENERATED seat node_modules volumes <<<'

emit_mounts() {
    local seat entry suffix path
    for seat in "${SEATS[@]}"; do
        for entry in "${PKGS[@]}"; do
            suffix="${entry%%:*}"
            path="${entry#*:}"
            printf '      - nm-%s-%s:%s/%s%s/node_modules\n' \
                "$seat" "$suffix" "$WORKTREE_ROOT" "$seat" "$path"
        done
    done
}

emit_volumes() {
    local seat entry suffix
    for seat in "${SEATS[@]}"; do
        for entry in "${PKGS[@]}"; do
            suffix="${entry%%:*}"
            printf '  nm-%s-%s:\n' "$seat" "$suffix"
        done
    done
}

# Replace everything strictly between BEGIN and END with the output of the
# named emitter, keeping the markers. awk rather than sed: the payload contains
# slashes and colons, so nothing needs escaping. The payload goes through a
# FILE rather than -v: BSD awk (this is a macOS-hosted repo) rejects a newline
# inside a -v assignment ("newline in string").
splice() {
    local file="$1" begin="$2" end="$3" emitter="$4" tmp payload
    grep -qxF "$begin" "$file" || { echo "gen-seat-volumes: marker missing in $file: $begin" >&2; exit 1; }
    grep -qxF "$end"   "$file" || { echo "gen-seat-volumes: marker missing in $file: $end" >&2; exit 1; }
    tmp="$(mktemp)"; payload="$(mktemp)"
    "$emitter" > "$payload"
    awk -v begin="$begin" -v end="$end" -v pf="$payload" '
        $0 == begin { print; while ((getline line < pf) > 0) print line; close(pf); skip = 1; next }
        $0 == end   { print; skip = 0; next }
        !skip       { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
    rm -f "$payload"
}

render() {
    local target="$1"
    splice "$target" "$MOUNTS_BEGIN" "$MOUNTS_END" emit_mounts
    splice "$target" "$VOLS_BEGIN"   "$VOLS_END"   emit_volumes
}

case "${1:-}" in
    --write)
        render "$COMPOSE"
        echo "gen-seat-volumes: rewrote $COMPOSE (${#SEATS[@]} seats x ${#PKGS[@]} packages)"
        ;;
    --check)
        tmp="$(mktemp)"
        cp "$COMPOSE" "$tmp"
        render "$tmp"
        if diff -u "$COMPOSE" "$tmp"; then
            echo "gen-seat-volumes: compose.devcontainer.yml is up to date"
        else
            echo "gen-seat-volumes: DRIFT - run gen-seat-volumes.sh --write and commit" >&2
            rm -f "$tmp"
            exit 1
        fi
        rm -f "$tmp"
        ;;
    ''|--print)
        echo "$MOUNTS_BEGIN"
        emit_mounts
        echo "$MOUNTS_END"
        echo "$VOLS_BEGIN"
        emit_volumes
        echo "$VOLS_END"
        ;;
    *)
        echo "usage: gen-seat-volumes.sh [--print|--write|--check]" >&2
        exit 2
        ;;
esac

#!/bin/bash
# Root-run one-shot (postCreateCommand) for the things that can only be done
# with root and only once the container has its mounts.
#
# DIVERGED from ~/code/devcontainer-template/shared/devcontainer-init.sh as of
# the single-container rework. That template copy globs /workspaces/*, which no
# longer describes this repo's layout: the repo and its seat worktrees are
# bind-mounted at their HOST-IDENTICAL absolute paths (see the header of
# compose.devcontainer.yml for the git-2.39.5 reason), and /workspaces holds
# only compat symlinks. Anything generic in here should still be landed in both
# copies; the WORKSPACES array below is the careerforge-specific part.
#
# What this does:
# 1. Volume mount-point ownership: docker creates named volumes root-owned when
#    the mount point does not exist in the image (ours sit on bind-mounted
#    trees), so the container user cannot write them until this runs.
# 2. git safe.directory for every real workspace path. The image cannot set it
#    at build time and a glob does not work - MEASURED on git 2.39.5 in the
#    node:24-bookworm base, 2026-08-17: safe.directory '/workspaces/*' still
#    fails with "detected dubious ownership"; only the bare '*' matches, which
#    trusts every repository the container can see. Enumerating the actual
#    directories keeps the grant exact. Without this the .githooks/pre-commit
#    gate fails OPEN - gitleaks swallows git's error and prints "no leaks
#    found" after scanning ~0 bytes.
# 3. Pins the Claude Code CLI to the version the host runs.
#
# Deliberately takes NO arguments: sudoers exposes this file verbatim, and
# parameterizing it would hand the container user arbitrary root chown,
# arbitrary safe.directory entries, and arbitrary root npm installs. Every path
# below is a constant or comes from globbing the filesystem, never a caller.
set -euo pipefail

USERNAME=node
id vscode >/dev/null 2>&1 && USERNAME=vscode

# The main checkout, then every seat worktree. Host-identical absolute paths -
# keep in lockstep with compose.devcontainer.yml and devcontainer.json.
MAIN=/Users/carlos/code/careerforge
WORKTREES=/Users/carlos/code/careerforge-worktrees

for d in "$MAIN"/node_modules \
         "$MAIN"/apps/*/node_modules \
         "$MAIN"/packages/*/node_modules \
         "$WORKTREES"/*/node_modules \
         "$WORKTREES"/*/apps/*/node_modules \
         "$WORKTREES"/*/packages/*/node_modules; do
    # -L guard is load-bearing, not hygiene: this loop runs as root via the
    # NOPASSWD sudoers grant, and the glob reaches into bind-mounted trees which
    # the container user fully controls. Without it, a symlink planted at
    # e.g. apps/x/node_modules -> /etc lets the unprivileged user chown /etc to
    # itself and escalate to root inside a NET_ADMIN container (proven, PR #219
    # adversarial review). chown does NOT follow the link only when we refuse a
    # symlink target outright.
    if [ -d "$d" ] && [ ! -L "$d" ]; then
        chown "$USERNAME" "$d"
    fi
done

# safe.directory for the main checkout AND each worktree. Both are needed: a
# worktree's .git file points back into "$MAIN"/.git/worktrees/<name>, so git
# touches both paths on every command run from a seat.
# Idempotent: --add would otherwise stack a duplicate entry every re-run.
for w in "$MAIN" "$WORKTREES"/*; do
    [ -d "$w/.git" ] || [ -f "$w/.git" ] || continue
    if ! git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$w"; then
        git config --system --add safe.directory "$w"
    fi
done

# --- Claude Code version pin -------------------------------------------------
# MUST MATCH THE HOST'S BREW-INSTALLED VERSION EXACTLY. Carlos runs
# claude-code from the homebrew cask on the host; a container on a different
# build reads and writes the same transcript/settings shapes with different
# code, and the skew shows up as "works in my terminal, not in the seat".
# Check with `claude --version` on the host before changing this line; as of
# 2026-08-25 the cask is on 2.1.231 (2.1.245 exists only on other channels).
#
# Hardcoded on purpose: this script runs as root and the container user fully
# controls the bind-mounted repo, so nothing read from the workspace may decide
# what root installs. Bump = one-line commit + rebuild.
#
# The ghcr claude-code feature installs its own (unpinnable) version and its
# layer survives --build-no-cache, so this reinstall at postCreate is the pin.
# It works only here: postCreate runs before postStartCommand raises the egress
# firewall, which is the only window npm has to reach the registry. Never widen
# the allowlist to make an in-container update work later.
CLAUDE_PIN="2.1.231"
if command -v npm >/dev/null 2>&1; then
    installed="$(npm ls -g --depth=0 @anthropic-ai/claude-code 2>/dev/null \
        | grep -o '@anthropic-ai/claude-code@[0-9][0-9.]*' | cut -d@ -f3 || true)"
    if [ "$installed" != "$CLAUDE_PIN" ]; then
        echo "claude pin: ${installed:-none} -> $CLAUDE_PIN"
        npm install -g "@anthropic-ai/claude-code@$CLAUDE_PIN"
    else
        echo "claude pin: already $CLAUDE_PIN"
    fi
fi

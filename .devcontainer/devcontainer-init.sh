#!/bin/bash
# Root-run one-shot for things that can only be known once the container has
# its mounts: the workspace directory is named after the checkout it was
# created from (see the compose overlay), so the image build cannot address
# it by name.
#
# Shared VERBATIM with ~/code/devcontainer-template/shared/devcontainer-init.sh
# - `cf-fleet doctor` requires the two to be byte-identical, so keep any edit
# generic and land it in both.
#
# 1. Volume mount-point ownership: docker creates named volumes root-owned
#    when the mount point does not exist in the image (ours sit on the
#    bind-mounted workspace), so the container user cannot write them until
#    this runs.
# 2. git safe.directory for the real workspace path. The image cannot set it
#    (unknown name) and a glob does not work - MEASURED on git 2.39.5 in the
#    node:24-bookworm base, 2026-08-17: safe.directory '/workspaces/*' still
#    fails with "detected dubious ownership"; only the bare '*' matches, which
#    trusts every repository the container can see. Enumerating the actual
#    directories keeps the grant exact. Without this the .githooks/pre-commit
#    gate fails OPEN - gitleaks swallows git's error and prints "no leaks
#    found" after scanning ~0 bytes.
#
# Deliberately takes NO arguments: sudoers exposes this file verbatim, and
# parameterizing it would hand the container user arbitrary root chown - and
# now arbitrary safe.directory entries as well. Every path below comes from
# globbing the filesystem, never from a caller.
set -euo pipefail

USERNAME=node
id vscode >/dev/null 2>&1 && USERNAME=vscode

for d in /workspaces/*/node_modules \
         /workspaces/*/apps/*/node_modules \
         /workspaces/*/packages/*/node_modules; do
    # -L guard is load-bearing, not hygiene: this loop runs as root via the
    # NOPASSWD sudoers grant, and the glob reaches into the bind-mounted repo
    # which the container user fully controls. Without it, a symlink planted at
    # e.g. apps/x/node_modules -> /etc lets the unprivileged user chown /etc to
    # itself and escalate to root inside a NET_ADMIN container (proven, PR #219
    # adversarial review). chown does NOT follow the link only when we refuse a
    # symlink target outright.
    if [ -d "$d" ] && [ ! -L "$d" ]; then
        chown "$USERNAME" "$d"
    fi
done

# Idempotent: --add would otherwise stack a duplicate entry every re-run.
for w in /workspaces/*; do
    [ -d "$w/.git" ] || [ -f "$w/.git" ] || continue
    if ! git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$w"; then
        git config --system --add safe.directory "$w"
    fi
done

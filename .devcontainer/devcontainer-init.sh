#!/bin/bash
# Root-run one-shot for volume mount points: docker creates named volumes
# root-owned when the mount point does not exist in the image (ours sit on
# the bind-mounted workspace), so the container user cannot write them until
# this runs. Deliberately takes NO arguments: sudoers exposes this file
# verbatim, and parameterizing it would hand the container user arbitrary
# root chown.
set -euo pipefail

USERNAME=node
id vscode >/dev/null 2>&1 && USERNAME=vscode

for d in /workspaces/*/node_modules \
         /workspaces/*/apps/*/node_modules \
         /workspaces/*/packages/*/node_modules; do
    if [ -d "$d" ]; then
        chown "$USERNAME" "$d"
    fi
done

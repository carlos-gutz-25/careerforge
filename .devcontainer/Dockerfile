# Devcontainer for careerforge (Node 24 + pnpm via corepack). Claude Code
# itself is installed by the ghcr.io/anthropics/devcontainer-features feature
# (see devcontainer.json); this layer adds firewall tooling and bakes in the
# egress policy. Postgres is NOT here: the devcontainer joins the compose
# postgres service (see compose.devcontainer.yml).
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    sudo \
    zsh \
    fzf \
    gh \
    less \
    procps \
    nano \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
    jq \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# The repo pins pnpm through the package.json packageManager field.
RUN corepack enable

ENV DEVCONTAINER=true
ENV SHELL=/bin/zsh

# Shell history survives rebuilds via the volume mounted at /commandhistory.
RUN mkdir -p /commandhistory && touch /commandhistory/.zsh_history \
    && chown -R node:node /commandhistory \
    && echo 'export HISTFILE=/commandhistory/.zsh_history' > /home/node/.zshrc \
    && echo 'setopt INC_APPEND_HISTORY' >> /home/node/.zshrc \
    && chown node:node /home/node/.zshrc

# Pre-create mount points so volumes attach with the right owner.
RUN mkdir -p /home/node/.claude /workspaces/careerforge \
    && chown -R node:node /home/node/.claude /workspaces/careerforge

# Firewall: script + policy are root-owned inside the image; sudoers grants the
# node user exactly one root command, re-running the firewall script.
# Deliberately NOT named init-firewall.sh: the claude-code devcontainer
# feature ships its own script at /usr/local/bin/init-firewall.sh and would
# overwrite ours (feature layers build after this Dockerfile).
COPY init-firewall.sh /usr/local/bin/devcontainer-firewall.sh
COPY devcontainer-init.sh /usr/local/bin/devcontainer-init.sh
COPY allowed-domains.txt /etc/devcontainer/allowed-domains.txt
RUN chmod +x /usr/local/bin/devcontainer-firewall.sh /usr/local/bin/devcontainer-init.sh \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/devcontainer-firewall.sh, /usr/local/bin/devcontainer-init.sh" > /etc/sudoers.d/firewall \
    && chmod 0440 /etc/sudoers.d/firewall

USER node

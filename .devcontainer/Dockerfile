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

# Font tooling for evidence legs: fonttools sniffs a font file's REAL container
# format (would have caught the raw-TTF-named-.woff2 Fraunces defect
# mechanically); woff2 provides woff2_compress/woff2_decompress for round-trips.
# fonttools comes from pip in a venv, NOT apt: bookworm's python3-fonttools
# drags in a 622MB C/C++/Fortran toolchain (scipy, boost, gcc) - a
# compile-anything primitive this sandbox does not want. The venv is ~10MB.
RUN apt-get update && apt-get install -y --no-install-recommends \
    woff2 \
    python3-venv \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/fonttools \
    && /opt/fonttools/bin/pip install --no-cache-dir fonttools==4.63.0 \
    && ln -s /opt/fonttools/bin/fonttools /usr/local/bin/fonttools \
    && ln -s /opt/fonttools/bin/ttx /usr/local/bin/ttx \
    && ln -s /opt/fonttools/bin/pyftsubset /usr/local/bin/pyftsubset

# Chromium baked at BUILD time so Lighthouse/axe/screenshot evidence legs run
# inside the egress sandbox with no runtime browser download. Why runtime
# install fails even though the CDN entries were in allowed-domains.txt: the
# firewall (init-firewall.sh) pins one-shot dig responses into an ipset, and
# cdn.playwright.dev is an anycast CDN whose IPs rotate - so runtime installs
# EHOSTUNREACH intermittently by construction. Baking at build time makes the
# image the trust boundary; the now-dead CDN entries are removed from
# allowed-domains.txt in this same change.
# COUPLING: the version below must track the LOCKFILE-RESOLVED playwright
# (apps/web pins @playwright/test ^1.61.1; caret range - check pnpm-lock.yaml,
# currently exactly 1.61.1). On drift, Lighthouse/axe keep working (they use
# CHROME_PATH directly) but pnpm test:e2e resolves via the registry, finds no
# matching browser build, and fails loudly at the firewall. Bump both together.
# Supply-chain note: npx at build time bypasses the repo's minimumReleaseAge
# posture; accepted because the version is exact-pinned and the dep tree is
# playwright->playwright-core only.
# PLAYWRIGHT_BROWSERS_PATH redirects ALL playwright resolution to this
# root-owned path (immutable to the node user - deliberate; there is no
# writable fallback cache, so drift fails loudly instead of downloading).
# In-container Lighthouse numbers are DIRECTIONAL ONLY - the score of record
# stays in CI (ci.yml lighthouse budgets on pinned runner Chromium).
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/ms-playwright
RUN npx -y playwright@1.61.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /usr/local/ms-playwright \
    && CHROME="$(find /usr/local/ms-playwright -maxdepth 3 -type f -name chrome -path '*/chromium-*/*')" \
    && test -x "$CHROME" \
    && ln -s "$CHROME" /usr/local/bin/chromium-baked
# The find targets the FILE named chrome under chromium-* (excludes the
# chromium_headless_shell-* install, whose binary is headless_shell; on x64 the
# dir is chrome-linux64 so matching the directory name would find nothing).
# test -x is load-bearing: an empty or ambiguous find FAILS the build instead
# of shipping a green image with a dangling CHROME_PATH.
# chrome-launcher (LHCI) and anything honoring CHROME_PATH uses the stable link.
ENV CHROME_PATH=/usr/local/bin/chromium-baked

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

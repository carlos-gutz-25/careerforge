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
# fonttools comes from pip in a venv, NOT apt, and the reason is SIZE ONLY:
# bookworm's python3-fonttools pulls a dependency closure measured at 441.6MB
# installed-size (scipy/boost/openblas/gfortran) against 54MB for the venv.
# An earlier draft justified this as avoiding "a compile-anything primitive" -
# that was FALSE and is struck: the node:24-bookworm base already ships gcc,
# g++, make and perl, verified in-image, so the venv buys no such property.
# Residual, named not fixed: ~25MB of that 54MB is pip+setuptools with no use
# case here; --without-pip (or removing them post-install) would roughly halve
# it, but it changes a build surface this round has already verified, so it is
# parked rather than folded.
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
# inside the egress sandbox with no runtime browser download.
#
# Why a runtime `playwright install` fails - MEASURED in a lane container on
# 2026-08-13, with `registry.npmjs.org` returning 200 through the same firewall
# as the control. TWO independent causes, and both have to be stated because
# fixing either one alone would not have worked:
#  1. `cdn.playwright.dev` WAS allowlisted by name, yet connections were
#     rejected in ~2ms. init-firewall.sh resolves each name once and pins the
#     answers into an ipset; that host does not answer stably - three samples
#     seconds apart returned 150.171.110.178, then 13.107.226.57 and
#     13.107.253.57, across two unrelated Azure ranges - so the pinned set goes
#     stale and an allowlisted NAME still fails.
#  2. playwright then falls back to `playwright.download.prss.microsoft.com`
#     (Fastly, 199.232.x), which was NEVER on the allowlist at all - note it is
#     a different host from the allowlisted `vscode.download.prss.microsoft.com`
#     - so that attempt is rejected outright regardless of any pinning.
# Baking at build time makes the image the trust boundary; the now-dead CDN
# entries are removed from allowed-domains.txt in this same change.
# COUPLING: the version below must track the LOCKFILE-RESOLVED playwright
# (apps/web pins @playwright/test ^1.61.1; caret range - check pnpm-lock.yaml,
# currently exactly 1.61.1). On drift, Lighthouse/axe keep working (they use
# CHROME_PATH directly) but pnpm test:e2e looks for a browser build this image
# does not carry and fails at that check - "Executable doesn't exist at
# <path>", NOT at the firewall, since PLAYWRIGHT_BROWSERS_PATH has no writable
# fallback for it to try downloading into. Bump both together. There is a THIRD
# pin site: ci.yml's own playwright coupling comment - see the M14-08 park.
# Supply-chain note: npx at build time bypasses the repo's minimumReleaseAge
# posture; accepted because the version is exact-pinned and the dep tree is
# playwright->playwright-core only. Disclosed alongside it: `--with-deps` also
# installs a floating set of Debian runtime libraries plus the browser tarball
# at build time, and that surface is NOT version-pinned by anything here.
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

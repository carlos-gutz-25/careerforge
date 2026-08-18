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
# The pip+setuptools residual round-2 parked (~25MB of the 54MB with no use
# case) is now FOLDED, not parked: the strip below drops the venv to 29MB,
# and the change was re-verified by a fresh bare build + in-image probes
# (pip absent, ttx/pyftsubset/fonttools all working) before it shipped -
# which was the parking condition.
RUN apt-get update && apt-get install -y --no-install-recommends \
    woff2 \
    python3-venv \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/fonttools \
    && /opt/fonttools/bin/pip install --no-cache-dir fonttools==4.63.0 \
    && rm -rf /opt/fonttools/lib/python3.*/site-packages/pip \
        /opt/fonttools/lib/python3.*/site-packages/setuptools* \
        /opt/fonttools/lib/python3.*/site-packages/pkg_resources \
        /opt/fonttools/bin/pip* \
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
# (apps/web pins @playwright/test ^1.62.1; caret range - check pnpm-lock.yaml,
# currently exactly 1.62.1). MEASURED DRIFT 2026-08-14: this pin sat at 1.61.1
# (chromium-1228) while the lockfile had already moved to 1.62.1
# (chromium-1234), so every Playwright-driven leg failed at browser launch
# in-container. That is the caret-vs-bake invariant. It cannot be derived here
# because the build context is `.devcontainer`, not the repo root, so
# pnpm-lock.yaml is unreachable at build time - the drift check therefore lives
# in `cf-fleet doctor`, which runs where the lockfile exists. On drift,
# Lighthouse/axe keep working (they use
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
# TEMPORARY apt pin (2026-08-13): bookworm-security published xvfb
# 2:21.1.7-3+deb12u13 before its same-source xserver-common propagated
# (candidate stuck at deb12u12), so --with-deps hits "unmet dependencies"
# through no fault of ours; pre-installing the pair does NOT work because
# playwright's own apt call re-requests xvfb and apt tries the broken
# candidate. The pin forces BOTH candidates to the coinstallable deb12u12
# pair for exactly this layer, then deletes itself. Delete the printf/rm
# pair once a clean-container `apt-get install xvfb` resolves again.
RUN apt-get update \
    && printf 'Package: xvfb\nPin: version 2:21.1.7-3+deb12u12\nPin-Priority: 1001\n\nPackage: xserver-common\nPin: version 2:21.1.7-3+deb12u12\nPin-Priority: 1001\n' \
       > /etc/apt/preferences.d/tmp-xvfb-syncgap \
    && npx -y playwright@1.62.1 install --with-deps chromium \
    && rm /etc/apt/preferences.d/tmp-xvfb-syncgap \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
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

# Pre-create mount points so volumes attach with the right owner. The
# workspace directory itself is NOT pre-created any more: its name is the
# seat clone's basename (see compose.devcontainer.yml), which this build
# cannot know. Docker creates the missing mount point at run time, and
# devcontainer-init.sh fixes ownership of the node_modules volumes under it.
RUN mkdir -p /home/node/.claude /workspaces \
    && chown -R node:node /home/node/.claude \
    && chown node:node /workspaces

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

# --- Terminal + gate capability (2026-08-14 architecture audit) --------------
# Deliberately the LAST layers before USER node: everything expensive
# (apt, fonttools, the ~961MB Playwright/Chromium install) sits above and stays
# cached when these change.

# Ghostty's terminfo, compiled at build time. Without it a Ghostty-hosted shell
# lands on TERM=xterm and Claude Code's truecolor theme - including the
# daltonized diff palette - is crushed to basic ANSI. `cf-fleet shell` already
# falls back to xterm-256color, so this is the remaining polish: styled
# underlines (Su), SGR mouse past column 223, and kbs=\177 rather than xterm's
# incorrect ^H. Compiled from COMMITTED source rather than downloaded, so it
# works offline and behind the egress firewall; `tic` ships in the base image.
# Regenerate on a Ghostty host: infocmp -x xterm-ghostty > .devcontainer/xterm-ghostty.terminfo
COPY xterm-ghostty.terminfo /etc/devcontainer/xterm-ghostty.terminfo
RUN tic -x -o /usr/share/terminfo /etc/devcontainer/xterm-ghostty.terminfo

# Truecolor no matter how you attach (docker exec, devcontainer exec, VS Code).
# cf-fleet already passes COLORTERM explicitly; this covers every other path.
ENV COLORTERM=truecolor

# gitleaks, so .githooks/pre-commit CAN run in a lane. It does not yet: the
# hook is opt-in via core.hooksPath, which is still unset in all five seats and
# is deliberately NOT set here. Setting it before the image carries gitleaks
# would brick every in-container commit, so this PR ships the capability and
# the operator sets core.hooksPath afterwards (README:27, the
# `git config core.hooksPath .githooks` line - an earlier revision of this
# comment cited README:111, which is the opening fence of an unrelated code
# block). This layer removes the blocker; it does not flip the switch.
# Copied from the official image (statically linked, verified to run on
# bookworm) rather than downloaded. PINNED BY DIGEST, not by tag: an earlier
# revision of this line said "pinned by digest-backed tag", which is not a
# pin at all - a tag is mutable and the publisher can move v8.30.1 whenever
# they like. In a repo that runs a minimumReleaseAge posture and discloses its
# npx exception explicitly, claiming a guarantee the line did not provide was
# the defect worth fixing. The digest below was resolved independently twice,
# via `docker buildx imagetools inspect` and via the ghcr manifest API.
# `RUN gitleaks version` is load-bearing in the same way as the
# `test -x "$CHROME"` check above: fail the build rather than ship an image
# whose secret scanner does not execute.
# The container is the gate of record; `cf-fleet doctor` warns when the HOST
# copy is older, because with no .gitleaks.toml both sides use gitleaks'
# embedded default ruleset, which changes between releases. (cf-fleet is
# operator tooling and lives OUTSIDE this repo, at
# ~/careerforge-v2-ops/ops-tools/cf-fleet - do not look for it in the tree.)
COPY --from=ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f /usr/bin/gitleaks /usr/local/bin/gitleaks
RUN gitleaks version

# WITHOUT safe.directory THE PRE-COMMIT HOOK FAILS OPEN. The bind-mounted
# workspace root is owned by root (0:0) inside the container while .git is
# owned by node (1000:1000), so git 2.39 refuses every operation with
# "detected dubious ownership". `git diff --cached` then degrades to
# --no-index mode, the docs/profile guard matches nothing, and gitleaks
# swallows the git error and prints "no leaks found" after scanning ~0 bytes -
# a green gate that inspected nothing. Demonstrated 2026-08-14 with a planted
# PAT and a staged docs/profile/ file: hook exited 0 without it, 1 with it.
#
# It cannot be set HERE any more: the workspace path is now the seat clone's
# basename and this build does not know it. A glob does not help - MEASURED on
# git 2.39.5 in this exact base image (2026-08-17): safe.directory
# '/workspaces/*' still fails with "detected dubious ownership"; only the bare
# '*' (trust everything) matches, and that is a wider grant than the gate
# needs. devcontainer-init.sh therefore adds the EXACT directories it finds
# under /workspaces at postCreate time, as root, into the same system config.
#
# Container git identity, so a seat can actually commit. In the image rather
# than a seat's ~/.gitconfig because it must survive without any per-seat
# setup step; a seat that needs a different identity still overrides it with
# `git config --global`.
RUN git config --system user.name "CarlosGutz25" \
    && git config --system user.email "carlosgutz25@gmail.com"

USER node

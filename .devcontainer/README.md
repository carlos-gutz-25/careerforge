# The CareerForge devcontainer

What it is, where its boundary actually sits, and which work can be done inside it.

This file documents the container that already exists (`devcontainer.json`,
`compose.devcontainer.yml`, `Dockerfile`, `init-firewall.sh`, `allowed-domains.txt`). It adds no
capability of its own. Every boundary claim below was enumerated from inside a running lane
container on 2026-08-13; the method is at the bottom so a second party can re-run it.

## Why it exists

Several agent seats work this repo at once. Running them directly on the host means every seat
inherits the operator's full user account - SSH keys, cloud credentials, the keychain, every other
repository on the machine. The container narrows that to a declared set of mounts plus an
allowlisted egress path.

**Layout, as of the single-container rework (2026-08-25).** There is now ONE devcontainer, not one
per seat. Inside it the repo is bind-mounted at `/Users/carlos/code/careerforge` - its
*host-identical* absolute path - and the five seats are git worktrees under
`/Users/carlos/code/careerforge-worktrees/{a1-resume,a2-coaching,b1-portfolio,b2-web,review-seat}`,
bind-mounted at their host-identical path too. That is what makes one set of worktrees usable from
both sides: git writes worktree metadata as absolute paths, and this image's git 2.39.5 rejects the
whole repository if `worktree.useRelativePaths` is set. `/workspaces/careerforge` and
`/workspaces/careerforge-worktrees` survive as symlinks to the real paths. Seats are created
host-side by `init-seat-worktrees.sh` *before* `devcontainer up`.

Two consequences worth stating up front. The per-seat isolation that used to come from six separate
containers is gone - the seats share one kernel namespace, one Claude config volume and one memory
cgroup; what still separates them is one project path per seat (Claude Code keys its state on the
workspace path) and one `node_modules` volume per seat per package. And because the container is
long-lived and launchd-started, `shutdownAction` is `none`: closing a client never stops it.

## The boundary, stated honestly

The point of this section is **what you are not protected from**. Overselling this wall is worse
than having no wall, because the wall is what people rely on when they decide what to run.

### Inside the wall - reachable from any seat in the container

| Surface | How it gets in | Note |
| --- | --- | --- |
| The host checkout | bind mount -> `/Users/carlos/code/careerforge` | Read-write, at the host-identical absolute path. |
| All five seat worktrees, plus any other worktree under that root | bind mount -> `/Users/carlos/code/careerforge-worktrees` | Read-write, host-identical path. **Wider than the old per-lane mount**: one seat can read and write every other seat's working tree, and they all share the main checkout's `.git`. Worktree isolation here is a convention, not a boundary. |
| The v2-ops coordination bus | bind mount -> `/home/node/careerforge-v2-ops` | **Read-write, on purpose** - it is the sanctioned cross-seat channel. Git-versioned on the host, so writes are recoverable. |
| The project's own `.env` | lives inside the checkout | In-wall. Seat rules, not the container, keep `.env` closed. |
| **Claude state and the sign-in, shared by all five seats** | named volume `careerforge_claude-config` -> `/home/node/.claude` | **The most important line in this table.** With one container this volume is shared by construction. Per-*session* state is still separated, because Claude Code keys its project directory on the workspace path and the five seats sit at five distinct paths - but the credential is one credential, and any seat can read it. That is a real reduction from the six-container layout and is accepted deliberately: the seats were never a trust boundary against each other, only against the host. |
| A shared `vscode` volume | named volume `vscode` -> `/vscode` | Un-prefixed, therefore shared with any other devcontainer on the machine. Carries the VS Code server install, not credentials. |
| Postgres | shared network namespace (`network_mode: service:postgres`) | `localhost:5432` in-container behaves exactly as it always has. The **host**-published port is `127.0.0.1:4610` (project block 4600-4999), not 5432. |
| `docs/profile/` - **only if the host checkout or a worktree happens to hold it** | via the checkout / worktree bind mounts | Untracked and local-only, so a fresh worktree never carries it by virtue of being a worktree. **It is not excluded by the container**: if it is on disk under either mounted path, it is in the wall - and there is now only one checkout to check rather than six. Check it; do not assume. |

### Outside the wall - verified unreachable

macOS keychain / `~/.ssh` / `~/.aws` / the `gh` token (in-container `gh` is unauthenticated **by
design**) / the host's own `~/.claude` / every other repository on the machine / the Docker socket
(absent, so a seat cannot inspect or control containers) / all non-allowlisted egress.

The mount table is what establishes this, not the absence of any single file: it enumerates
**every** bind mount and named volume, so a surface that is not in it is not reachable.

### The wall is not uniform: `git push` is **not** blocked

This was measured, not assumed, and it contradicts the natural reading of the line above.

`gh` is unauthenticated in here, so it is easy to conclude that GitHub write access is outside the
wall. **It is not.** When VS Code attaches to the container, the Dev Containers extension installs a
credential helper into **both** `/etc/gitconfig` and `~/.gitconfig` that proxies the *host's* git
credentials into the container over a helper script in `/tmp`. A seat can therefore `git push` to
the real remote, and this document exists because a seat did exactly that.

So the boundary splits in a way worth stating plainly:

- **`gh` (and therefore `gh pr merge`)** - genuinely unavailable in-container. No token is present.
- **`git push`** - **available** whenever VS Code is attached. Nothing in the container stops it.

"Merges happen on the host" is therefore a **policy** enforced by seat rules and by branch
protection on the remote, **not** a boundary the container enforces. Anyone reasoning about blast
radius should assume a seat container can write to any branch the operator's git credentials can
write to. Branch protection - required PRs with an empty bypass list - is what actually stands
between a seat and `main`, and it is doing more work than the sandbox is.

### What this wall is not

It is not a defence against a seat that misuses what is legitimately inside it. The bus is
read-write, the checkout is read-write, and the Claude credential is shared. The container limits
**reach**, not authority.

## Host / container split

| Work | Where | Status |
| --- | --- | --- |
| `pnpm install` | container | Works. |
| `pnpm typecheck`, `pnpm lint` | container | Works. |
| `pnpm test` (unit + integration) | container | Works - Postgres is reachable over the shared netns. |
| `pnpm test:e2e` (Playwright) | container | Chromium is **baked into the image**, so no runtime download is needed. See below for what that does and does not establish. |
| `git push` | container **can** do this | Works via VS Code's proxied git credentials - see "The wall is not uniform" above. Seat policy still routes PR creation through the host; the container does not enforce that. |
| all `gh`, merge ceremony | **host only** | `gh` is unauthenticated in-container by design, so PR creation and merges genuinely cannot happen here. |
| launchd nightly backup | **host only** | Needs the Docker socket and host paths. |
| `node scripts/privacy-check.mjs` | **host only, in practice** | The gate verifies REAL career data, so in a clone without `docs/profile/` - the ordinary in-container case - it exits **2 = "cannot run"**, which the gate itself prints as *"Not a pass."* Run it on a host checkout that holds the real profile, after the final commit and before pushing. |

### The e2e disposition, stated plainly

**Chromium is baked into the image at build time** (`PLAYWRIGHT_BROWSERS_PATH`, with a stable
`/usr/local/bin/chromium-baked` symlink and `CHROME_PATH`), so browser-backed legs no longer depend
on a runtime download. **Do not run `playwright install` in here** - the browsers directory is
root-owned on purpose, so there is no writable fallback and drift fails loudly instead of silently
downloading.

**What this establishes, and what it does not.** It removes the provisioning blocker; it is not by
itself a green e2e run. The version baked into the image must track the lockfile-resolved playwright,
and on drift `pnpm test:e2e` fails with "Executable doesn't exist" rather than at the firewall.

**Why the earlier allowlist approach could not work** - measured 2026-08-13, with
`registry.npmjs.org` returning 200 through the same firewall as the control, so this is not "egress
was simply off":

- `cdn.playwright.dev` **was** allowlisted, and connections were still rejected in ~2ms.
  `allowed-domains.txt` is resolved **once** into an ipset, and that hostname does not answer
  stably - three samples seconds apart spanned two unrelated Azure ranges - so the pin goes stale
  and an allowlisted *name* still fails.
- Playwright then falls back to `playwright.download.prss.microsoft.com`, which was never listed at
  all. Note it is a different host from the allowlisted `vscode.download.prss.microsoft.com`.

Either cause alone would have been enough to break the download, which is why adding hosts to the
list was not a fix. Baking makes the image the trust boundary instead.

**The cost, stated rather than left to be discovered:** baking is not free. The browser payload is
~961MB, taking the verify image from ~2.36GB to ~3.61GB - about +1.25GB, paid once per image build
rather than per lane, since layers dedupe across containers. Rebuild ONE lane first so the layer
cache is warm; six simultaneous cache-miss builds would each pull the payload separately.

## Standing requirement: `BACKUP_PG_CONTAINER`

`scripts/db-backup.mjs` refuses to guess which postgres container to dump: `selectPgContainer`
throws when more than one matches its service-label filter, and setting `BACKUP_PG_CONTAINER=<name>`
in `.env` resolves it. An explicit name must be among the running set, or it throws as well.

Under the retired six-clone layout every booted lane contributed its own candidate, so this was hit
constantly. With one compose project there is normally exactly one candidate and the setting is
inert - but keep it. It is a **standing requirement of multi-clone development, not a devcontainer
workaround**: it predates the container, and any second clone or a stray stopped-then-restarted
project brings the ambiguity straight back. `docs/RUNBOOKS.md` carries the operator-facing version.

## Re-running the boundary check

From inside a running container:

```sh
findmnt -rno TARGET,SOURCE     # the primary instrument: every bind mount and named volume
```

Spot checks that annotate it - `ls ~/.ssh/id_*`, `gh auth status`, and a check for whether
`docs/profile/` is present in this clone. Two probes that a Linux container can only ever fail -
looking for the macOS `security` binary, or for a host path under `~/code` that in-container `~`
does not have - prove nothing and are not evidence either way.

A probe that unexpectedly **succeeds** - reaching a host credential or private data - is a finding.
Report it; do not quietly work around it.

# The CareerForge devcontainer

What it is, where its boundary actually sits, and which work can be done inside it.

This file documents the container that already exists (`devcontainer.json`,
`compose.devcontainer.yml`, `Dockerfile`, `init-firewall.sh`, `allowed-domains.txt`). It adds no
capability of its own. Every boundary claim below was enumerated from inside a running lane
container on 2026-08-13; the method is at the bottom so a second party can re-run it.

## Why it exists

Several agent seats work this repo at once, each in its own clone. Running them directly on the host
means every seat inherits the operator's full user account - SSH keys, cloud credentials, the
keychain, every other repository on the machine. The container narrows that to a declared set of
mounts plus an allowlisted egress path.

## The boundary, stated honestly

The point of this section is **what you are not protected from**. Overselling this wall is worse
than having no wall, because the wall is what people rely on when they decide what to run.

### Inside the wall - reachable from any seat in the container

| Surface | How it gets in | Note |
| --- | --- | --- |
| That lane's own host checkout | bind mount -> `/workspaces/careerforge` | Read-write. Host-side path is that lane's clone directory. |
| The v2-ops coordination bus | bind mount -> `/home/node/careerforge-v2-ops` | **Read-write, on purpose** - it is the sanctioned cross-seat channel. Git-versioned on the host, so writes are recoverable. |
| The project's own `.env` | lives inside the checkout | In-wall. Seat rules, not the container, keep `.env` closed. |
| **A Claude sign-in shared by every lane** | named volume `careerforge-claude-config` -> `/home/node/.claude` | **The most important line in this table.** The volume name is deliberately un-prefixed, so all lane containers mount the *same* one. One compromised lane container reaches every lane's Claude credential. This is intentional (one sign-in, not five) and is documented in `compose.devcontainer.yml`; what had never been written down is the consequence, which is this sentence. |
| A shared `vscode` volume | named volume `vscode` -> `/vscode` | Also un-prefixed, therefore shared across lane containers. Carries the VS Code server install, not credentials. |
| Postgres | shared network namespace (`network_mode: service:postgres`) | `localhost:5432` behaves exactly as on the host. |
| `docs/profile/` - **only if that lane's host checkout happens to hold it** | via the checkout bind mount | Untracked and local-only, so a clone never carries it by virtue of being a clone. **It is not excluded by the container**: if it is in the checkout, it is in the wall. In the clone measured here it was **absent**. Check per clone; do not assume. |

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
| `pnpm test:e2e` (Playwright) | container | **UNTESTED in-container - and currently not provisionable.** See below. |
| `git push` | container **can** do this | Works via VS Code's proxied git credentials - see "The wall is not uniform" above. Seat policy still routes PR creation through the host; the container does not enforce that. |
| all `gh`, merge ceremony | **host only** | `gh` is unauthenticated in-container by design, so PR creation and merges genuinely cannot happen here. |
| launchd nightly backup | **host only** | Needs the Docker socket and host paths. |
| `node scripts/privacy-check.mjs` | **host only, in practice** | The gate verifies REAL career data, so in a clone without `docs/profile/` - the ordinary in-container case - it exits **2 = "cannot run"**, which the gate itself prints as *"Not a pass."* Run it on a host checkout that holds the real profile, after the final commit and before pushing. |

### The e2e disposition, stated plainly

e2e has **not** been run in this container, and as of 2026-08-13 it cannot be without an egress
change. `allowed-domains.txt` lists `cdn.playwright.dev` and `playwright.azureedge.net` under
"Playwright browser downloads", but `playwright install chromium` resolves its build to
`playwright.download.prss.microsoft.com` (a different host from the allowlisted
`vscode.download.prss.microsoft.com`) and the download fails. The intent to support e2e is already
in the allowlist; the host list is simply out of date with what Playwright now fetches.

Changing the allowlist is deliberately **not** done here - `allowed-domains.txt` is baked into the
image so a running container cannot widen its own access, and egress policy is maintained
separately from story work. Recorded in `docs/BACKLOG.md` under the M14 arc.

## Standing requirement: `BACKUP_PG_CONTAINER`

Every lane clone is its own compose project, and none of them set a top-level `name:`, so **each
booted lane contributes its own container matching the backup script's service-label filter**.
`scripts/db-backup.mjs` refuses to guess between them: `selectPgContainer` throws when more than one
matches, and setting `BACKUP_PG_CONTAINER=<name>` in `.env` resolves it. An explicit name must be
among the running set, or it throws as well.

This is a **standing requirement of multi-clone development, not a devcontainer workaround** - it
predates the container and would apply just as much to plain worktrees. The rule is what matters;
the number of running containers varies with how many lanes are booted and is never a fact worth
writing down. `docs/RUNBOOKS.md` carries the operator-facing version.

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

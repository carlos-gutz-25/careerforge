#!/usr/bin/env bash
# PreToolUse guard: refuse file-path tools on credential-bearing files.
#
# CLAUDE.md states ".env stays closed and unselected in the editor while agent
# sessions run" and treats any value that reaches an unintended surface as
# rotated-by-default. That was prose. This is the enforcement.
#
# It is wider than `permissions.deny: ["Read(./.env)"]`, which covers only a
# repo-relative Read of exactly `.env`. This also covers absolute paths, Edit,
# Write, NotebookEdit and Grep, every `.env.<suffix>`, and the common
# credential filenames that rule never mentioned.
#
# ---------------------------------------------------------------------------
# WHAT THIS DOES NOT COVER - stated plainly, because a guard whose limits are
# unclear gets trusted past them:
#
#   * Bash. `cat .env` carries no file path and is not matched. An earlier
#     version of this note said "the sandbox and permission rules are the
#     controls there" - CHECKED, AND THAT WAS FALSE. All six seats allowlist
#     Bash(tail:*), Bash(head:*), Bash(grep:*), Bash(perl:*), Bash(python3:*),
#     Bash(od:*), Bash(cut:*) and Bash(tr:*) with no prompt, so `tail -n 50
#     .env` runs unprompted and unhooked in every one of them. There is no
#     compensating control on that path today. The honest statement is that
#     this guard raises the cost of an accident on the file-path tools and does
#     nothing about a deliberate Bash read.
#   * Any tool not in the settings.json matcher. The first draft of this guard
#     described the hole as "the Bash gap"; that was wrong. It is a
#     non-file-path-tool gap, and Grep was the easy one - Grep is now matched.
#   * A real secret stored in a file NAMED `.env.example`. The four template
#     names below are allowlisted by convention, since `.env.example` is tracked
#     on purpose and a test asserts every schema key appears in it. A secret put
#     there is caught by gitleaks and CI, not by this hook.
#
# BYPASSES CLOSED 2026-08-15 after adversarial review proved each one live:
#   * `.ENV` / `.Env` - APFS is case-insensitive, so these read the same bytes.
#     Matching is now done on a lowercased name.
#   * A symlink named `notes.md` pointing at `.env` - the guard saw the link
#     name. The path is now resolved before matching.
#   * `notebook_path` payloads - NotebookEdit was in the matcher but its field
#     was never read.
#   * `credentials.json`, `.npmrc`, `.netrc`, `.aws/credentials` and friends -
#     simply absent from the list.
# ---------------------------------------------------------------------------
#
# Exit 2 blocks the tool call. Exit 0 allows it. EVERY OTHER EXIT CODE ALLOWS
# IT, which is why every internal failure below exits 2: a secrets guard that
# silently stops guarding is worse than none, because its presence is read as
# coverage.
set -uo pipefail   # deliberately NOT -e: each failure is handled explicitly

die_closed() {
  echo "BLOCKED by .claude/hooks/guard-secrets.sh: the guard could not run ($1)." >&2
  echo "Failing CLOSED rather than letting a possibly-credential path through." >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || die_closed "jq not found on PATH"

input="$(cat)" || die_closed "could not read the hook payload"

# Grep uses `path`; NotebookEdit uses `notebook_path`; the rest use `file_path`.
raw="$(printf '%s' "$input" \
  | jq -r '(.tool_input.file_path // .tool_input.notebook_path // .tool_input.path) // empty' 2>/dev/null)" \
  || die_closed "could not parse the hook payload"

[ -z "$raw" ] && exit 0

# Resolve symlinks so a link cannot launder the name. The path may not exist
# yet (Write creates files), so fall back to the literal string.
resolved="$raw"
if [ -e "$raw" ]; then
  resolved="$( { readlink -f "$raw" 2>/dev/null || python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$raw" 2>/dev/null; } )" \
    || resolved="$raw"
  [ -z "$resolved" ] && resolved="$raw"
fi

# Strip trailing slashes before taking the basename: `${resolved##*/}` on
# "/r/.env/" yields the EMPTY string, which matched nothing and allowed the
# path through. Found by review 2026-08-15.
trimmed="$resolved"
while [ "${trimmed%/}" != "$trimmed" ] && [ "$trimmed" != "/" ]; do
  trimmed="${trimmed%/}"
done

base="${trimmed##*/}"
lower="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')"

blocked() {
  echo "BLOCKED by .claude/hooks/guard-secrets.sh: refusing to touch '$base'." >&2
  [ "$resolved" != "$raw" ] && echo "  ('$raw' resolves to '$resolved')" >&2
  echo "  $1" >&2
  echo "  This repo is PUBLIC. Secrets are STOP-and-ask (PROTOCOL-CORE rule 11)." >&2
  echo "  Read .env.example for variable NAMES." >&2
  exit 2
}

case "$lower" in
  # Documented templates carry NAMES, not VALUES. `example.tfvars` is tracked
  # in infra/terraform/ and reading it is ordinary work - caught by running the
  # new *.tfvars rule against `git ls-files` before shipping it, which is the
  # only reason this arm has a tfvars entry at all.
  .env.example|.env.sample|.env.template|.env.dist)
    exit 0
    ;;
  # The `.envrc.*` rule added alongside `.env.*` needs the same template
  # carve-out, or a documented direnv example becomes unreadable.
  .envrc.example|.envrc.sample|.envrc.template)
    exit 0
    ;;
  example.tfvars|*.example.tfvars|*.tfvars.example|*.tfvars.sample|terraform.tfvars.example)
    exit 0
    ;;
  # `.envrc` (direnv) and `*.env` (prod.env, staging.env) are both mainstream
  # secret-bearing conventions that the first pattern list missed: `.env.*`
  # requires the dot AFTER env, so neither matched. Proven live by adversarial
  # review 2026-08-15 - both were ALLOWED with a credential in them.
  .env|.env.*|.envrc|.envrc.*|*.env)
    blocked "CLAUDE.md: a value that leaves .env for an unintended surface is rotated by default."
    ;;
  credentials.json|service-account*.json|token.json|.git-credentials|.npmrc|.netrc|.pgpass|kubeconfig|secrets.yaml|secrets.yml|.htpasswd|.pypirc)
    blocked "This filename conventionally holds live credentials."
    ;;
  # *.tfvars matters here specifically: this repo has infra/terraform/.
  *.tfvars|*.tfvars.json)
    blocked "Terraform variable files conventionally carry live credentials."
    ;;
  *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*.p8|id_rsa|id_rsa.*|id_dsa|id_dsa.*|id_ed25519|id_ed25519.*|id_ecdsa|id_ecdsa.*)
    blocked "This looks like a private key or keystore."
    ;;
esac

# Whole directories that only ever hold credentials.
#
# The leading-slash forms are not enough on their own: a path that does not
# exist yet (a Write creating `.aws/credentials`) is never resolved to an
# absolute path, so a RELATIVE one has no `/` before `.aws` and slipped
# through. Creating a new credentials file in a public repo is precisely what
# this rule exists to stop, so the bare-relative forms are matched too.
case "$resolved" in
  */.aws/*|*/.ssh/*|*/.gnupg/*|*/.docker/config.json)
    blocked "Path is inside a credential directory."
    ;;
  .aws/*|.ssh/*|.gnupg/*|.docker/config.json)
    blocked "Path is inside a credential directory (relative form)."
    ;;
  */.docker/config.json.*|.docker/config.json.*)
    blocked "A backup copy of a Docker credential file is still a credential file."
    ;;
esac

# The credential DIRECTORY ITSELF, not just paths inside it. Every pattern above
# requires something after the slash, so `.aws`, `/home/u/.ssh` and `~/.gnupg`
# were all allowed - and Grep is in the matcher precisely so a directory-scoped
# search is guarded. A recursive grep over ~/.ssh is the credential dump this
# rule exists to stop, and it was the one shape that walked through.
case "$lower" in
  .aws|.ssh|.gnupg)
    blocked "This IS a credential directory; a directory-wide read is exactly what this guard is for."
    ;;
esac

exit 0

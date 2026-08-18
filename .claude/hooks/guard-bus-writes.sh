#!/usr/bin/env bash
# PreToolUse guard (matcher "Bash"): refuse shell writes into the guarded roots.
#
# Edit/Write/MultiEdit/NotebookEdit are governed by permissions.deny globs.
# Bash is not: `printf x >> ~/careerforge-v2-ops/lanes/carlos.INBOX.md` carries
# no file_path field and no deny glob can see it. This hook is the Bash half of
# that perimeter, and it covers three roots:
#
#   OPS ROOT    /Users/carlos/careerforge-v2-ops  |  /home/node/careerforge-v2-ops
#   STATE ROOT  /Users/carlos/careerforge-state   |  /home/node/careerforge-state
#   the clone's own .claude/  (hooks and settings are the perimeter itself;
#                              `rm -rf .claude/hooks` must not be a one-liner)
#
# ---------------------------------------------------------------------------
# THE RULE IT ENFORCES, exactly (contract "Guard hooks"):
#
#   DENY (exit 2) only on POSITIVE resolution of a write target under a
#   guarded root. Everything else - unparseable commands, runtime-assembled
#   paths, variables, command substitution, a jq that is not installed - is
#   ALLOWED. This is a deliberate choice, not an oversight: a fail-closed Bash
#   guard that cannot parse shell would deny ordinary work all day, and the
#   residual is covered by fleetd's tripwire (it recomputes expected state
#   from events.d and pages on divergence).
#
#   Internal errors exit 2 ONLY after a guarded-root write has already been
#   positively identified. Before that point they exit 0.
#
# WHAT IT DOES NOT COVER, plainly:
#   * `eval "$cmd"`, `bash script.sh`, heredocs assembled at runtime, and any
#     path built from a variable. Advisory + audited, by design.
#   * Writes from inside a program the command starts (a node script that
#     opens the file itself).
#   * Container-side raw writes generally - virtiofs squashes uid, so file
#     permissions cannot help here. That approach is dead and must not be
#     proposed again.
# ---------------------------------------------------------------------------
set -uo pipefail

# ===========================================================================
# FIRST LINE OF LOGIC: the canonical seat-CLI invocation is allowed
# unconditionally, before any code that could fail. `seat` writes to the state
# root constantly - that is its entire job - and a bug in the analysis below
# must never be able to stop heartbeats fleet-wide.
# Pinned absolute paths; the hooks test asserts these exact strings.
# ===========================================================================
CANON_HOST_SEAT="/Users/carlos/careerforge-state/bin/seat"
CANON_CONTAINER_SEAT="/home/node/careerforge-state/bin/seat"

input=""
input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0
CMD="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$CMD" ] || exit 0

case "$CMD" in
  "$CANON_HOST_SEAT "*|"$CANON_HOST_SEAT") exit 0 ;;
  "$CANON_CONTAINER_SEAT "*|"$CANON_CONTAINER_SEAT") exit 0 ;;
  "$CANON_HOST_SEAT-wrapper "*|"$CANON_CONTAINER_SEAT-wrapper "*) exit 0 ;;
esac

# Carried over from design r3 ("except ops-tools/seat and bus-append"): lane
# prose appends go through bus-append.sh, which is the tool that REFUSES
# over-cap and non-ASCII lines before writing. Denying it would push every lane
# append back to raw printf, which is strictly worse. Remove this block if the
# integrator decides lane appends must route through `seat announce` only.
case "$CMD" in
  */ops-tools/bus-append.sh\ *|*/ops-tools/bus-append.sh) exit 0 ;;
esac

TOOL_CWD="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)" || TOOL_CWD=""
[ -n "$TOOL_CWD" ] || TOOL_CWD="$PWD"

HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || HOOK_DIR=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  CLONE="$CLAUDE_PROJECT_DIR"
elif [ -n "$HOOK_DIR" ]; then
  CLONE="$(cd "$HOOK_DIR/../.." 2>/dev/null && pwd)" || CLONE=""
else
  CLONE=""
fi

# ===========================================================================
# The analysis itself. Shell quoting, `&&`/`;`/`|` splitting and per-utility
# argument shapes are the whole problem here, and getting them wrong in bash
# string-matching is how a guard ends up with a hole nobody can see. python3's
# shlex does the tokenising; this script keeps the decision.
#
# The command is passed as argv, never interpolated into the program text.
# ===========================================================================
command -v python3 >/dev/null 2>&1 || exit 0

# The heredoc lives inside a function, NOT inside $( ), because bash tracks
# quote state while scanning a command substitution and the python below
# contains both quote characters. Wrapped the other way round this file
# does not even parse.
analyze() {
  python3 - "$1" "$2" "$3" <<'PY'
import os
import shlex
import sys

cmd, cwd, clone = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "")

GUARDED = [
    "/Users/carlos/careerforge-v2-ops",
    "/home/node/careerforge-v2-ops",
    "/Users/carlos/careerforge-state",
    "/home/node/careerforge-state",
]
if clone:
    GUARDED.append(os.path.join(clone, ".claude"))

def canonical(path):
    """readlink -f semantics that also work on a path that does not exist yet:
    resolve the longest existing ancestor, then re-append the tail."""
    if path.startswith("~"):
        path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.join(cwd or os.getcwd(), path)
    path = os.path.normpath(path)
    head, tail = path, []
    while True:
        if os.path.exists(head):
            return os.path.normpath(os.path.join(os.path.realpath(head), *tail))
        parent = os.path.dirname(head)
        if parent == head:
            return path
        tail.insert(0, os.path.basename(head))
        head = parent

ROOTS = []
for root in GUARDED:
    ROOTS.append(canonical(root))

def guarded(path):
    """The path IS at or under a guarded root."""
    try:
        resolved = canonical(path)
    except Exception:
        return None
    for root in ROOTS:
        if resolved == root or resolved.startswith(root + os.sep):
            return resolved
    return None

def contains_guarded(path):
    """The path CONTAINS a guarded root - a repo-wide `git clean` at the clone
    root reaches .claude/ without ever naming it."""
    try:
        resolved = canonical(path)
    except Exception:
        return None
    for root in ROOTS:
        if root.startswith(resolved.rstrip(os.sep) + os.sep):
            return root
    return None

def looks_like_path(token):
    return ("/" in token) or token.startswith("~")

def space_operators(text):
    """Put whitespace around unquoted shell operators so shlex yields them as
    tokens. `echo x>>/ops/f` and `a&&b` carry no spaces, and a guard that only
    matches the spaced spelling is a guard with a one-character bypass.
    `>>` becomes two `>` tokens; the redirection scan below handles that."""
    out = []
    quote = None
    escaped = False
    skip_next = False
    for index, ch in enumerate(text):
        if skip_next:
            skip_next = False
            continue
        if escaped:
            out.append(ch)
            escaped = False
        elif ch == "\\" and quote != "'":
            out.append(ch)
            escaped = True
        elif quote:
            out.append(ch)
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
            out.append(ch)
        elif ch in (">", "<"):
            # Keep the two-character forms whole: `>|` split into `>` `|`
            # would look like a pipe and lose its target.
            operator = ch
            if index + 1 < len(text) and text[index + 1] in (">", "|"):
                operator += text[index + 1]
                skip_next = True
            out.append(" " + operator + " ")
        elif ch in (";", "&", "|"):
            out.append(" " + ch + " ")
        else:
            out.append(ch)
    return "".join(out)

try:
    tokens = shlex.split(space_operators(cmd), comments=False, posix=True)
except ValueError:
    # Unbalanced quotes: unparseable, therefore nothing positively identified.
    sys.exit(0)

# Split into simple commands on the shell operators shlex leaves as tokens.
SEPARATORS = ("&&", "||", ";", "|", "&", "|&")
segments, current = [], []
for token in tokens:
    if token in SEPARATORS:
        if current:
            segments.append(current)
        current = []
    else:
        current.append(token)
if current:
    segments.append(current)

WRITERS_LAST_ARG = ("cp", "mv", "install", "ln", "rsync")
WRITERS_ALL_ARGS = ("rm", "rmdir", "truncate", "unlink", "shred")
INTERPRETERS = ("python", "python2", "python3", "perl", "node", "ruby", "sh", "bash", "zsh")
GIT_DESTRUCTIVE = ("clean", "stash", "checkout", "reset", "restore")

def report(reason, target):
    print("DENY\t%s\t%s" % (reason, target))
    sys.exit(0)

for segment in segments:
    if not segment:
        continue
    base = os.path.basename(segment[0])

    # --- redirections: the target is whatever follows > or >> -------------
    for index, token in enumerate(segment):
        stripped = token
        # 2>file, &>file, 1>>file all reduce to the same question.
        while stripped and (stripped[0].isdigit() or stripped[0] == "&"):
            stripped = stripped[1:]
        if stripped in (">", ">>", ">|"):
            if index + 1 < len(segment):
                hit = guarded(segment[index + 1])
                if hit:
                    report("shell redirection", hit)
        elif stripped.startswith(">>") and len(stripped) > 2:
            hit = guarded(stripped[2:])
            if hit:
                report("shell redirection", hit)
        elif stripped.startswith(">") and len(stripped) > 1 and stripped[1] != ">":
            hit = guarded(stripped.lstrip(">|"))
            if hit:
                report("shell redirection", hit)

    args = segment[1:]
    positional = [a for a in args if not a.startswith("-")]

    # --- tee: every non-flag argument is an output file --------------------
    if base == "tee":
        for arg in positional:
            hit = guarded(arg)
            if hit:
                report("tee output", hit)

    # --- dd of=PATH --------------------------------------------------------
    elif base == "dd":
        for arg in args:
            if arg.startswith("of="):
                hit = guarded(arg[3:])
                if hit:
                    report("dd of=", hit)

    # --- sed -i / --in-place: every file argument is rewritten in place ----
    elif base == "sed":
        in_place = any(a == "--in-place" or a.startswith("--in-place=")
                       or (a.startswith("-") and not a.startswith("--") and "i" in a[1:])
                       for a in args)
        if in_place:
            for arg in positional:
                hit = guarded(arg)
                if hit:
                    report("sed in-place", hit)

    # --- cp/mv/install/ln/rsync: the DESTINATION is the last non-flag arg --
    elif base in WRITERS_LAST_ARG:
        destinations = []
        for index, arg in enumerate(args):
            if arg in ("-t", "--target-directory") and index + 1 < len(args):
                destinations.append(args[index + 1])
            elif arg.startswith("--target-directory="):
                destinations.append(arg.split("=", 1)[1])
        if not destinations and positional:
            destinations.append(positional[-1])
        for destination in destinations:
            hit = guarded(destination)
            if hit:
                report("%s destination" % base, hit)

    # --- rm/rmdir/truncate/shred: every non-flag argument is a target ------
    elif base in WRITERS_ALL_ARGS:
        for arg in positional:
            hit = guarded(arg)
            if hit:
                report("%s target" % base, hit)

    # --- interpreters with inline programs: a literal guarded path anywhere
    #     in the segment is enough. -e/-c programs are opaque, so the only
    #     honest test is "does it name a guarded path at all".
    elif base in INTERPRETERS:
        if any(a.startswith("-e") or a.startswith("-c") or a == "--eval" for a in args):
            for arg in args:
                for piece in arg.replace("'", " ").replace('"', " ").split():
                    if looks_like_path(piece):
                        hit = guarded(piece)
                        if hit:
                            report("%s inline program" % base, hit)

    # --- git: the destructive verbs discard untracked and staged state -----
    elif base == "git":
        verb = None
        directory = None
        skip = False
        for index, arg in enumerate(args):
            if skip:
                skip = False
                continue
            if arg == "-C" and index + 1 < len(args):
                directory = args[index + 1]
                skip = True
                continue
            if not arg.startswith("-") and verb is None:
                verb = arg
        # Only the forms that actually discard WORKTREE content count. A branch
        # switch or a `--soft` reset writes nothing a seat can lose, and
        # denying those would make the guard unusable in the busiest clone.
        destructive = False
        if verb == "clean":
            destructive = True
        elif verb == "reset":
            destructive = any(a in ("--hard", "--merge", "--keep") for a in args)
        elif verb == "stash":
            sub = next((a for a in positional if a not in (verb,)), None)
            destructive = sub not in ("list", "show", "drop", "branch")
        elif verb in ("checkout", "restore"):
            destructive = ("--" in args
                           or any(a in ("-f", "--force") for a in args)
                           or any(a == "." for a in positional))

        if destructive:
            if "--" in args:
                paths = args[args.index("--") + 1:]
            elif verb == "clean":
                paths = [a for a in positional if a != verb]
            else:
                # Bare arguments to reset/checkout/stash are refs, not
                # pathspecs - except one that literally names a guarded path.
                paths = [a for a in positional
                         if a != verb and looks_like_path(a) and guarded(a)]
            if paths:
                for candidate in paths:
                    hit = guarded(candidate) or contains_guarded(candidate)
                    if hit:
                        report("git %s" % verb, hit)
            else:
                # Repo-wide: the scope is the whole worktree, which reaches
                # the clone's own .claude/ - the perimeter itself - without
                # ever naming it. That is why containment counts here.
                scope = directory if directory else cwd
                hit = guarded(scope) or contains_guarded(scope)
                if hit:
                    report("git %s (repo-wide)" % verb, hit)
PY
}

VERDICT="$(analyze "$CMD" "$TOOL_CWD" "$CLONE" 2>/dev/null)" || VERDICT=""

case "$VERDICT" in
  DENY*)
    reason="$(printf '%s' "$VERDICT" | cut -f2)"
    target="$(printf '%s' "$VERDICT" | cut -f3)"
    echo "BLOCKED by .claude/hooks/guard-bus-writes.sh: $reason writes to a guarded root." >&2
    echo "  target: $target" >&2
    echo "  Guarded: the ops root, the dispatch state root, and this clone's .claude/." >&2
    echo "  Machine state is written ONLY through the seat CLI:" >&2
    echo "    $CANON_HOST_SEAT   (host)" >&2
    echo "    $CANON_CONTAINER_SEAT   (container)" >&2
    exit 2
    ;;
esac

exit 0

#!/usr/bin/env bash
# SessionStart hook: re-assert the rules a session is most likely to be missing.
#
# SessionStart stdout is added to the model's context (docs/en/hooks.md: "The
# exceptions are UserPromptSubmit, UserPromptExpansion, and SessionStart, where
# Claude Code adds plain-text stdout as context that Claude can see and act
# on."). So this is not logging - it is instruction re-injection.
#
# MODE RESOLUTION, and why it is belt-and-braces. The mode arrives as $1 from
# the `args` field in settings.json. That works today - verified against the
# installed CLI - but it was the ONLY source in the first version, and the
# failure mode was silent and total: no argument meant the case fell through,
# the script exited 0 having printed nothing, and settings.json advertised a
# re-injection with nothing behind it. Nothing would have reported that. The
# seat image installs Claude Code through a devcontainer feature that is not
# pinned to a CLI version, so a rebuild moves it freely.
#
# So: prefer $1, and fall back to the `source` field of the hook payload on
# stdin, which is the documented and stable field. Either path alone is enough.
#
# Keep every branch SHORT. This text is spent context on every matching event.
set -uo pipefail

mode="${1:-}"

if [ -z "$mode" ]; then
  # No argument: read the payload. Guarded so a missing jq or a malformed
  # payload degrades to "print nothing" rather than to a shell error - this
  # hook adds context, and a hook that cannot add context must not break the
  # session start it is attached to.
  payload="$(cat 2>/dev/null || true)"
  if [ -n "$payload" ] && command -v jq >/dev/null 2>&1; then
    mode="$(printf '%s' "$payload" | jq -r '.source // empty' 2>/dev/null || true)"
  fi
fi

# resume, clear and fork all skip the boot ritual, so they all skip the model
# check. `clear` and `fork` were missing from the first version even though its
# own stated rationale covered them word for word.
case "$mode" in

  resume|clear|fork)
    # WHY: a session that did not run the boot ritual never checked its model,
    # and the boot ritual is the ONLY thing enforcing the model law. Measured
    # 2026-08-14: seat session ea90a336 carried 115 events on claude-opus-4-8
    # and zero on opus-5, first event 2026-08-04, last event 2026-08-14 - it was
    # resumed and worked in for ten days across the 2026-08-08 law without ever
    # re-checking.
    echo "[hook: this session started via '$mode' - the boot ritual did NOT re-run]"
    cat <<'TXT'
The boot ritual is the only thing that enforces the model law, and this entry
point skips it. STANDING MODEL LAW - PROTOCOL.md, the "## STANDING MODEL LAW"
section that the rest of the corpus cites as :185: every seat runs OPUS-CLASS,
NON-FAST, CURRENT VERSION. Read that section rather than any version name quoted
here; "current" is the whole point and a snapshot would go stale. Check your own
model now, and if it is behind, stop and tell Carlos to /model this terminal
rather than carrying on. A resumed or forked session keeps whatever model it
started with, however long ago that was.
Also re-read your STATE file before acting: your posture may be stale.
TXT
    ;;

  compact)
    # WHY: compaction summarizes conversation history, and the first things to
    # go are standing procedural rules that were never restated.
    #
    # These POINT rather than QUOTE, deliberately. An earlier version restated
    # the gate sequence inline and had already drifted from CLAUDE.md at birth -
    # it dropped the `set -o pipefail` escape hatch. That is the same objection
    # that killed the gates SKILL in this same wave: a second copy of law drifts
    # silently away from the first. The mechanism changed from skill to hook;
    # the argument did not.
    cat <<'TXT'
[hook: context was COMPACTED - re-asserting rules compaction tends to drop]
Re-read these rather than trusting a summary of them. They are the ones this
project has actually been bitten by, and all of them are load-bearing:
- CLAUDE.md, "Hard rules" and "Workflow": the gate sequence and the bare-command
  rule, verbatim and complete.
- .claude/rules/verification.md: the planted-FAIL recipe law and the NUL/C0 scan.
- .claude/rules/privacy.md: privacy-check exit 2 means CANNOT RUN, never a pass.
Two that are one line each and are the ones most often lost:
- A check that inspected NOTHING is not a pass. Zero files, zero bytes or zero
  tokens scanned means the check failed to run - report it as such.
- Evidence before claims: show the command and its real output. Outcome text is
  authored AFTER the outcome exists.
TXT
    ;;

esac

exit 0

#!/usr/bin/env bash
# SessionStart hook: re-assert the rules a session is most likely to be missing.
#
# SessionStart stdout is added to the model's context (docs/en/hooks.md: "The
# exceptions are UserPromptSubmit, UserPromptExpansion, and SessionStart, where
# Claude Code adds plain-text stdout as context that Claude can see and act
# on."). So this is not logging - it is instruction re-injection.
#
# The mode is passed as $1 by the registration in settings.json rather than
# parsed out of the hook payload, so this script does not depend on an input
# field name that may change.
#
# Keep every branch SHORT. This text is spent context on every matching event.
set -euo pipefail

case "${1:-}" in

  resume)
    # WHY: a resumed session never re-runs the boot ritual, and the boot ritual
    # is the ONLY thing enforcing the model law. Measured 2026-08-14: seat
    # session ea90a336 carried 115 events on claude-opus-4-8 and zero on
    # opus-5, first event 2026-08-04, last event 2026-08-14 - it was resumed and
    # worked in for ten days across the 2026-08-08 law without ever re-checking.
    cat <<'TXT'
[hook: this session was RESUMED - the boot ritual did NOT re-run]
The boot ritual is the only thing that enforces the model law, and resume skips
it. STANDING MODEL LAW - PROTOCOL.md, the "## STANDING MODEL LAW" section that
the rest of the corpus cites as :185: every seat runs OPUS-CLASS, NON-FAST,
CURRENT VERSION. Read that section rather than any version name quoted here;
"current" is the whole point and a snapshot would go stale. Check your own model
now, and if it is behind, stop and tell Carlos to /model this terminal rather
than carrying on. A resumed session keeps whatever model it started with,
however long ago that was.
Also re-read your STATE file before acting: your posture may be stale.
TXT
    ;;

  compact)
    # WHY: compaction summarizes conversation history, and the first things to
    # go are standing procedural rules that were never restated. These five are
    # the ones this project has actually been bitten by.
    cat <<'TXT'
[hook: context was COMPACTED - re-asserting rules compaction tends to drop]
- Gates run BARE: pnpm typecheck && pnpm lint && pnpm test. Never pipe a gate
  through anything that can consume its exit code.
- A check that inspected NOTHING is not a pass. Zero files, zero bytes or zero
  tokens scanned means the check failed to run - report it as such.
- privacy-check exit 2 = CANNOT RUN. Never report it as a pass.
- Any change to a verification gate ships a demonstrated planted-FAIL in the
  same change, as a recipe a second party can re-run.
- Evidence before claims: show the command and its real output. Outcome text is
  authored AFTER the outcome exists.
TXT
    ;;

esac

exit 0

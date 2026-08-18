# /boot - claim this clone's seat and take work (shared, tracked)

This is the ONE boot command for every careerforge seat clone. Seat identity
comes from data, not from which copy of this file you have: the untracked
one-line file `.claude/seat` names this clone's seat. Until 2026-08-17 each
clone carried a different untracked boot.md - unversioned, unreviewable, and
absent from every fresh clone. This file replaces all of them.

## Steps (do them in order; stop where a step tells you to stop)

1. **Resolve identity.** Read `.claude/seat`. If it is missing, say so and
   STOP - this clone is unmanaged and must not claim anything. Ask Carlos
   (or the dispatcher lane) which seat this clone should be.

2. **Resolve roots.** State root: first existing of
   `/Users/carlos/careerforge-state` or `/home/node/careerforge-state`.
   Ops root: `/Users/carlos/careerforge-v2-ops` or
   `/home/node/careerforge-v2-ops`. If the STATE root is unreachable from
   this environment, report it and STOP (a container without the state mount
   cannot hold a seat; the ops bus alone is not tenure).

3. **Model check.** Read your model from your own system prompt and compare
   to the seat's `model` in `<state-root>/fleet.json`. Mismatch in an
   interactive session: tell Carlos to `/model` this terminal, then
   re-verify. (Spawned sessions never hit this - fleetd preflights it.)

4. **Claim.** Run: `<state-root>/bin/seat claim <seat> --interactive`
   (spawned task sessions are claimed by their wrapper - if you were spawned
   with a work item, your claim already exists; run
   `<state-root>/bin/seat status --json` and verify it instead).
   - Exit 0: you own the seat.
   - Exit 3 (CLAIM_LOST): someone else holds it. Do NOT wait-loop. Report
     the owner (from status --json) and STOP.
   - Exit 4 (FENCED): this clone lost a race or a generation moved. STOP.
   - Exit 5/6: state error or unreachable root. Report exactly what the CLI
     printed and STOP.

5. **Orient.** Read, in order: your lane charter `lanes/<seat>.md` (ops
   root), your `lanes/<seat>.STATE.md`, your `lanes/<seat>.INBOX.md` tail,
   and `<state-root>/STATUS.md` (derived view - never act on it alone).
   PROTOCOL-CORE.md governs conduct; the seat CLI governs state.

6. **Take work.** `<state-root>/bin/seat take-work <seat>` shows what is
   assigned to you. Work items are files - your item's frontmatter carries
   scope_owns / scope_must_not_touch / acceptance / evidence. Honor scope
   exactly; the fence and the guards enforce what prose used to ask.
   No item assigned: report "booted, seat held, no work assigned" to your
   lane STATE, then idle per your charter. Never invent work.

7. **Heartbeat discipline is automatic.** The Stop hook heartbeats every
   turn end; the fence guard heartbeats every allowed tool call. If any
   `seat` call returns exit 4 mid-tenure: STOP ALL WORK immediately - you
   have been fenced (reaped or superseded). Do not write anywhere; report
   the fence message and end the session.

8. **Ending a tenure.** Interactive: just exit - the SessionEnd hook
   releases your claim. If you are handing off deliberately, write your
   STATE first per PROTOCOL-CORE. Spawned: run `seat done <item> ...` per
   your item's evidence contract in your MAIN turn (never backgrounded),
   then exit; fleetd handles the release.

## What this replaces
- The per-clone untracked boot.md files (archived to the ops repo under
  archive/boot-md-pre-vnext/ at cutover).
- The DISPATCH.md claim protocol (board retired as a lock at cutover; claims
  live at `<state-root>/claims/` behind atomic mkdir + generation fencing).

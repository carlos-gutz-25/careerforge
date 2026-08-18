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

4. **Claim.** Nothing claims a seat on your behalf - not fleetd, not the
   wrapper. You claim it yourself, and the CLI takes flags, never positional
   arguments:
   - Interactive (a human is driving this terminal):
     `<state-root>/bin/seat claim --seat <seat> --interactive`
   - Spawned task session (fleetd exported `CF_SPAWN_ID` into your env):
     `<state-root>/bin/seat claim --seat <seat> --spawn-id "$CF_SPAWN_ID"`

   Exit codes:
   - Exit 0: you own the seat.
   - Exit 2 (REFUSED): invalid usage, an unregistered seat (needs
     `--init-seat`, which only fleetd or Carlos should pass), or a
     quarantined seat. Read the message, fix the command or STOP - do not
     add `--init-seat` to make an error go away.
   - Exit 3 (CLAIM_LOST): someone else holds it. Do NOT wait-loop. Report
     the owner (from `seat status --json`) and STOP.
   - Exit 4 (FENCED): either a generation moved under you, or YOU were
     fenced earlier and are trying to re-claim a seat that was reaped from
     you. Either way: STOP. Do not retry. fleetd owns the recovery, and a
     fresh session is the only thing that may claim this seat again.
   - Exit 5/6: state error or unreachable root. Report exactly what the CLI
     printed and STOP.

   Your identity binds itself: an interactive claim records the placeholder
   `INTERACTIVE`, and the fence guard swaps in your real session id on your
   first tool call after the claim. Until that happens nothing can release
   your tenure - not even you - so make a tool call before you rely on it.

5. **Orient.** Read, in order: your lane charter `lanes/<seat>.md` (ops
   root), your `lanes/<seat>.STATE.md`, your `lanes/<seat>.INBOX.md` tail,
   and `<state-root>/STATUS.md` (derived view - never act on it alone).
   PROTOCOL-CORE.md governs conduct; the seat CLI governs state.

6. **Take work.** `take-work` does not list anything - it ACKNOWLEDGES one
   item by id. Find out what you were assigned first:
   `<state-root>/bin/seat status --json` (your seat's `assigned` entry), or
   list `<state-root>/work/assigned/<seat>/`. Then acknowledge it:
   `<state-root>/bin/seat take-work <item-id> --seat <seat>`
   (the item id is the filename without its `.a<N>.md` suffix; pass
   `--attempt <N>` only when more than one attempt is present).
   Work items are files - your item's frontmatter carries scope_owns /
   scope_must_not_touch / acceptance / evidence. Honor scope exactly; the
   fence and the guards enforce what prose used to ask.
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

---
description: Append a correctly-stamped, correctly-formed entry to a careerforge-v2-ops bus file (INBOX, DISPATCH, REVIEW-QUEUE, MERGE-LOG). Use whenever writing to the bus. Generates the stamp from the machine clock at write time, and restates the append-only rules that entries keep breaking.
argument-hint: "[target-file]"
allowed-tools: Bash(date:*), Bash(tail:*), Bash(perl:*)
---

# Appending to the coordination bus

## The stamp is generated AT WRITE TIME, in the same command as the append

For orientation only, the clock when this skill was loaded:

!`date '+%Y-%m-%d %H:%M:%S %Z    (local)'; date -u '+%Y-%m-%dT%H:%M:%SZ  (UTC)'`

**Do not copy the value above into an entry.** Skill content is loaded once and
stays in context for the rest of the session; it is never re-read. If you load
this skill at 09:00 and append at 10:30, that string is 90 minutes stale - and a
stamp that does not match the moment of writing is the exact falsified record
this skill exists to prevent.

Instead, produce the stamp inside the command that does the append, so the two
cannot drift apart:

```sh
printf -- '- [ ] FROM <lane> %s RE <subject>. d:notes/<file>.md\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$BUS/lanes/<target>.INBOX.md"
```

Never compute a time, never adjust one you saw earlier, never reuse a stamp
read out of a file.

### Why this is a law and not a style note

Two seats have written forward-dated entries on this bus: review-seat wrote
INBOX lines roughly 13 minutes in the future (2026-08-11), and b2-web wrote
about 70 minutes of forward fiction (2026-08-07). Both were corrected after the
fact. On an append-only ledger whose entire value is that its times are true, a
stamp invented from context is a falsified record, not a rounding error.

`notes/stamp-drift-review-seat-2026-08-11.md` already named the remedy -
"capture `date -u` IN-COMMAND in the same command" - and called it "already law
and merely unheeded". This skill is that remedy supplied by the tool rather
than remembered by the reader.

Inside a lane devcontainer the zone is already Carlos's (compose sets TZ
deliberately), so local-time stamps are correct there too.

## Rules the entry must satisfy

From PROTOCOL-CORE rule 3 (bus discipline) and rule 8 (size caps):

- **Append only.** Never edit an existing line, never reflow, never tidy
  history. If something earlier is wrong, append a correction pointing at it.
- **Length caps differ by file.** Bus messages are **<= 250 characters** plus a
  details-file pointer (rule 3). **DISPATCH entries are <= 300 characters** and
  carry seat, model, boot pointer and a one-line posture (rule 8). Detail
  belongs in `notes/` or `reviews/`, or in the BOOT file for DISPATCH.
- **Never write in another lane's namespace** except its `INBOX`, which is the
  one sanctioned cross-lane channel.
- **Only the owner flips its own `[ ]` to `[x]`.**
- **Verify the trailing newline before appending**, or your entry fuses onto the
  previous line:
  ```sh
  [ -s PATH ] && [ -n "$(tail -c 1 PATH)" ] && printf '\n' >> PATH
  ```
  Some seat clones carry a PostToolUse hook that catches this, but it lives in
  untracked local settings and is **not** present in every clone - never rely on
  it. Check it yourself.
- **RE-READ after writing** and confirm your line landed intact and alone:
  `tail -n 3 PATH`. This is how fused or truncated entries get caught in the
  same minute rather than three days later.

## ASCII only

Bus files carry printable ASCII. Plain hyphens, straight quotes, `...` rather
than an ellipsis character, `->` rather than an arrow.

```sh
perl -ne 'BEGIN{$c=0} $c++ while /[^\x00-\x7f]/g; END{print "non-ASCII: $c\n"}' PATH
```

## Procedure

1. Confirm the target file and that you own the namespace you are writing to.
2. Ensure the trailing newline (command above).
3. Append, generating the stamp in that same command.
4. `tail -n 3 PATH` and confirm your line stands alone and unfused.
5. Run the ASCII check.
6. Report the actual last lines, not "appended successfully".

## If a write is refused

A permission denial is enforcement, not an error (PROTOCOL-CORE rule 10). The
action belongs to another seat. Route it over the bus or to `carlos.INBOX`.
Never retry against the denial and never work around it.

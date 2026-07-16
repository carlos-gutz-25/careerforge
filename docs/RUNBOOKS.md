# CareerForge — Runbooks

Operational procedures with an owner and a trigger. A runbook exists **before**
the thing it protects: the Anthropic key-rotation runbook below was written and
reviewed before the key was provisioned (M1-04 key-hygiene constraint).

## Anthropic API key rotation

**Trigger:** any exposure event per the CLAUDE.md hard rule — the value leaves
`.env` for any unintended surface (editor-selection attachment, terminal echo,
transcript, paste). Rotation is the default response; dismissal requires
proving the value was never live.

**Prerequisites (set once, at provisioning):**

- The key lives in a dedicated Anthropic Console **workspace** (`careerforge`),
  so spend caps, usage, and rotation are scoped to this project.
- Key names carry a date suffix (e.g. `careerforge-local-2026-07`) so the
  active key is identifiable during rotation.
- Workspace spend limit **$20/month** (hard cap, the budget ceiling from
  OPEN-QUESTIONS Q1) + a usage alert at ~$10.
- Keys are displayed **once** at creation; the Console never re-shows them.

**Procedure (create-before-revoke — the tool never goes dark mid-rotation):**

1. Console → `careerforge` workspace → API Keys → **create the replacement
   key** (new date-suffixed name). Copy it once, directly into `.env`
   `ANTHROPIC_API_KEY` — editor closed/unselected; edit via terminal.
2. Verify the new key live: `pnpm llm:smoke` (prints model + token usage +
   latency only; never the key).
3. Console → **disable/delete the old key**.
4. Verify the old key is dead (a call with the old value → 401
   `authentication_error`) if the old value is still recoverable; otherwise
   rely on the Console state.
5. Record the disposition in the session ledger (exposure #N → ACTED-ON, key
   name, date).

**Standing invariants (enforced in `packages/llm`):** the key is read via
validated env only (`parseLlmEnv`) — never a CLI argument, never a URL, never
logged, never included in an error message. `.env.example` documents the
variable **name only**.

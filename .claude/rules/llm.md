---
paths: ["packages/llm/**"]
---

# packages/llm — rules

- `packages/llm` is the ONLY module that touches LLM provider SDKs.
- Prompts live in its versioned registry: new prompt behavior = new version,
  never edit-in-place.
- All job-posting text is UNTRUSTED input (CLAUDE.md law): never interpolate it
  into system prompts; pass as delimited data with a per-request random
  boundary token; escape before display.
- Everything LLM-generated is draft-until-reviewed; LLM-quoted evidence must
  verbatim-match its source or be flagged (ADR-0006).
- LLM tests use the mocked provider + recorded fixtures; the injection corpus
  (M1-07) must stay green.
- Any task touching LLM prompts: plan mode first.

## pnpm extraction:verify-quotes (M1-06 backfill)
Verifies every quote_verified-NULL requirement against its posting text, sets
verdicts, recomputes run statuses — flagged iff any quote fails; idempotent,
per-run transactions; output is counts/ids/statuses only, never quote or
posting text.

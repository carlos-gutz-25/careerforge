# ADR-RESERVED: Application gameplan (new artifact class)

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M7-05 (schema/core) / M7-07 (service). **Pattern basis:** the M3-04 interview-prep template.

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until its owning story lands, then it is renamed `00NN-application-gameplan.md` and authored in full.

## What it will record

- A new drafting artifact class: `strategySummary` + one `phaseStrategy` per
  `apply|screen|interview|offer` + 0..6 STAR `stories` (each with >=1 evidenceRef belonging to a
  cited requirement). Reviewed-inputs-only; pin-to-report; posting-scoped; review CAS.
- **Never-send enforcement** (defense in depth): no message-shaped field in the schema, a
  strengthened prompt, and a deterministic message-likeness tripwire (line-anchored
  salutations/sign-offs/`subject:`/emails). The **commission-only residual** is named in the ADR.
- Deterministic (non-LLM) parts: phase constants derived from `APPLICATION_STAGES`, code-owned
  checklist templates, read-time timeline overlay from `application_events`.
- UI presents as three views (Apply / Speak / Process) over one artifact.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M7.

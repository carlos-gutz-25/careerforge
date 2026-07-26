# ADR-RESERVED: External-recommendation honesty (no-URL law)

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M7-01. **Applies to:** all drafting families that name external things.

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until M7-01 lands, then it is renamed `00NN-external-recommendation-honesty.md` and authored in full.

## What it will record

- The **no-URL law**: a URL emitted by the model is an unverifiable citation. A deterministic
  external-pointer tripwire (http/www/domain/email patterns, with dotted-tech-name negatives such as
  "Node.js" test-pinned) flags the run and writes nothing.
- The suggestion lifecycle: `kind in {resource, certification, demo_project, practice}`, and
  `status in {suggested, adopted, dismissed}` where `adopted` is the user's own attestation.
- UI honesty copy: "model suggestions from training data - verify currency yourself."
- Certification framing: recommend only when posting evidence beats the alternative use of time.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M7.

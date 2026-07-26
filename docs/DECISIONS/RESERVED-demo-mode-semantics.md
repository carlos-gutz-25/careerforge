# ADR-RESERVED: Demo mode semantics

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M10-05 (with M10-03 implementation).

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until its owning story lands, then it is renamed `00NN-demo-mode-semantics.md` and authored in full.

## What it will record

- **Key-absent posture**: no `ANTHROPIC_API_KEY` in Azure at all; pre-generated real artifacts are
  seeded; paid-LLM POSTs return a structured `DEMO_DISABLED` envelope (defense in depth atop the
  absent key). Capped-live-key and mocked-live postures are **rejected**, with reasons recorded.
- **Mutation policy** under `DEMO_MODE=1`: posting paste stays enabled (rate-limited, 1 MiB-capped;
  it demonstrates ingestion + the XSS-inert rendering law, while extraction honestly returns
  `DEMO_DISABLED`); reviews/status toggles on seeded artifacts allowed; everything resets nightly.
- Published demo credentials + login prefill, persistent demo banner, `robots.txt` Disallow + noindex
  (demo build only), per-IP mutation rate limit.
- **Fail-closed**: the demo image refuses to boot without `DEMO_MODE=1` plus the example seed marker;
  the real-profile import path is absent from the image and `docs/profile/` is `.dockerignore`d.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M10.

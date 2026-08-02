# ADR-0023: Demo mode semantics

**Status:** Accepted | **Date:** 2026-08-02

Authored at M10-05 from the reserved stub (`RESERVED-demo-mode-semantics.md`, reserved 2026-07-26 at
M5-02). This ADR records what the M10-03 and M10-04 implementations **shipped** (PR #135, PR #136) plus
the posture decisions behind them: how a single `DEMO_MODE=1` container becomes a public, honest,
fictional-data demo that never calls a paid LLM and never impersonates one. It is the semantics
companion to ADR-0022 (the deployment shape). Every mechanism below cites the shipped identifier from
the merged tree.

## Context

ADR-0022 puts a fictional-data instance of the platform on a public URL. A public box that can reach a
paid LLM and mutate a database is a liability: cost, prompt-injection surface, and the risk of showing
a recruiter *fabricated* AI drafting dressed up as real. Demo mode is the set of rules that removes
those liabilities while keeping the demo genuinely useful - real ingestion, real deterministic
scoring, real pre-generated artifacts - and honest about exactly what is and is not live.

The governing honesty laws are inherited: everything LLM-generated is draft-until-reviewed (CLAUDE.md);
job-posting text is untrusted and rendered XSS-inert (ADR-0006); LLM-quoted evidence must verbatim-match
its source or be flagged (ADR-0006). Demo mode must not weaken any of them.

## Decision

`DEMO_MODE=1` turns a same-origin container (ADR-0022) into a public demo governed by the rules below.
The flag is parsed strictly (`DEMO_MODE` is on only for the exact string `"1"`; anything else, including
absent or empty, is off).

### Key-absent posture (keyless by decision, enforced not just omitted)

- **No `ANTHROPIC_API_KEY` in the cloud, ever.** Beyond omission, the env layer **fails closed**: if
  `DEMO_MODE=1` is set with a live key present, the process **refuses to boot** ("demo instances are
  keyless by decision - unset ANTHROPIC_API_KEY or unset DEMO_MODE"; env superRefine, PR #135). A demo
  cannot be silently pointed at a real key.
- **Rejected alternatives, with reasons:** a *capped live key* (real spend plus a prompt-injection
  surface on a public box) and a *mocked live provider* (dishonest - it would show fake drafting as if
  real). The demo shows pre-generated real artifacts instead.

### `DEMO_DISABLED` on the paid-LLM POSTs

The **eight LLM-draft POSTs** (extract, gameplan, interview-prep, learning-plan create, improvement
plan, resume compose, resume redraft, resume variant) are marked `config: { llmDraft: true }` and
return a structured **`DEMO_DISABLED` (403)** in demo mode instead of reaching the provider (their
outputs are pre-generated). The guard is a root hook that registers **after the auth guard**, so an
unauthenticated call to one of these routes still gets **401 first**, not 403 - a precedence pinned by
a test in both directions. The marked-route set is itself a **pinned gate** (the `llmDraft` pin test),
so adding a paid POST without marking it fails CI. `DEMO_DISABLED` also takes precedence over the
keyless 503 path.

### Mutation policy

- **Posting paste stays enabled** (it demonstrates real ingestion and the XSS-inert rendering law):
  a 100,000-character zod cap (`POSTING_RAW_TEXT_MAX_CHARS`) plus a ~1 MiB transport backstop. The
  subsequent **extraction is honestly `DEMO_DISABLED`** (it is a paid POST).
- **Reviews and status toggles on seeded artifacts stay live** - a visitor can exercise the
  review-gate flows against pre-generated drafts.
- **Per-IP mutation rate limit**: a hand-rolled fixed-window limiter (`createFixedWindowRateLimiter`,
  reused from the auth limiter) caps mutating requests at **60 per 10 minutes**
  (`DEMO_MUTATION_RATE_LIMIT_MAX = 60`, `DEMO_MUTATION_RATE_LIMIT_WINDOW_MS = 10 * 60_000`), returning
  **`RATE_LIMITED` (429)** over the cap; `POST /auth/login` is exempt and carries its own stricter
  limiter. The window is in-memory and therefore correct at one container (the demo runs exactly one
  task; ADR-0022).
- **`TRUST_PROXY`** (strict `"1"` parse) tells Fastify to read the real client IP from
  `X-Forwarded-For` when the API sits behind the API Gateway front, so per-IP limiting is accurate in
  the deployed shape (off by default, on only in the demo container).

### Fail-closed, three layers (all shipped)

1. **Env layer**: the `DEMO_MODE` + key superRefine above.
2. **Boot layer**: `main.ts` calls the seeded-marker check and throws `DemoUnseededError` if
   `DEMO_MODE=1` and no `demo_seed_state` marker exists - an **unseeded demo never serves** (the marker
   is a migration-0025 singleton, written LAST by `demo:seed`).
3. **Data layer**: `demo:seed` refuses (`DemoSeedRefusedError`) if the target user already has rows but
   **no** `demo_seed_state` marker - that looks like a real instance, so it can never clobber real
   data. Separately, the real-profile import CLI refuses to run under `DEMO_MODE=1`.

### Pre-generated artifacts (the honest core)

The demo's LLM-derived content is captured once, offline, and replayed keylessly:

- **`demo:capture`** (operator-attended, a **local live key**, a throwaway scratch DB, **fictional
  inputs only** - four authored fictional postings + the fictional example profile) drives the *real*
  services and exports a committed, zod-validated **fixture set with a hashed manifest**; the provider
  spend is recorded (PR #135 captured 15 calls, spend logged in the BUILD RECORD).
- **`demo:seed`** (keyless, idempotent, rerun-twice-identical) replays those fixtures into the
  bootstrap user. **Fit reports are recomputed LIVE by the deterministic engine at seed time** (they
  are genuinely computed, not copied - a stronger honesty than snapshotting them), and the captured
  artifacts are re-linked to the recomputed graph by identity.
- **Reviewed-state is a seeded STATUS on genuinely-reviewed items**, not a fabricated one: in the
  PR #135 attended review the operator human-reviewed every artifact and approved the split - **Resume
  document, Gameplan, and Improvement plan ship `reviewed`; Learning plan and Resume variant stay
  `draft`** (draft-until-reviewed stays literally true; one artifact, an interview-prep pack, was
  *withheld* by the M3-04 disclosure gate and seeded as-is, showing the gate working).
- **Fixture staleness posture, stated plainly**: fixtures snapshot the pipelines as they were at
  capture; a later prompt-version bump does not retro-update them, and **re-capture is the refresh
  mechanism** (attended, with recorded spend). A re-capture can shift which posting is the strongest
  fit and the exact gap counts (extraction is non-deterministic); the manifest pins the snapshot.
- **Encoding record (ADR-0006 preserved at value level)**: the committed fixture and posting bytes are
  printable ASCII, with non-ASCII codepoints written as `\uXXXX` escapes (the route-(C) source-byte
  provision); the **parsed values are exact**, so a seeded `quoteVerified: true` sourceQuote is still a
  verbatim substring of its seeded posting text. A seed-graph coherence gate asserts exactly this over
  the whole seeded set, with a demonstrated planted-FAIL (PR #135, R3).

### Published demo credentials

The demo login is a **deliberately public** pair: `demo@careerforge.example` /
`explore-the-demo-2026`, single-sourced in web `utils/demo.ts` and prefilled on the login page with a
persistent honest banner (PR #136). The RFC-reserved `.example` TLD and the obviously-non-secret
passphrase make it fictional by construction; the bootstrap env (`AUTH_BOOTSTRAP_PASSWORD`, ADR-0022)
must match it, documented in the M10-06 runbook. This is **distinct from the throwaway-smoke-credentials
law** (manual smokes still create and delete their own throwaway pair; the published demo pair is a
standing, intentionally-public fixture, not a smoke artifact).

### Discoverability: none

A public demo must never enter a search index. In demo mode the API serves a conditional public
**`GET /robots.txt`** (Disallow all) and stamps **`X-Robots-Tag: noindex, nofollow` on every response**
(PR #136). This is a **runtime** mechanism, a deliberate and disclosed deviation from the acceptance
criterion's "demo build only": build-time env is inert in this stack (the M10-01 probe chain), and the
container serves the SPA same-origin from the API (ADR-0022), so the API is the one surface that sees
every response. Off-demo there is no route and no hook, and a real instance is byte-for-byte unchanged.

### Reset and cold-start honesty

Reset is the backup: a nightly job drops/truncates and re-runs `demo:seed` (idempotency shipped;
scheduling at M10-06). The login banner is honest about the cold facts - the data is fictional, the
instance resets nightly, and paid drafting is disabled - so a visitor is never misled about what they
are looking at.

### `/health` carries `demo`

`GET /health` returns a `demo` boolean reflecting `env.DEMO_MODE` (PR #135); it is the flag source the
web affordances (banner, prefill, disabled triggers; PR #136) and the M10-08 uptime smoke read to tell
a demo instance from a real one - fetched fail-quiet on the web side, because the **server**, not the
client, enforces every rule above.

## Consequences

- **A public demo that cannot spend money or fabricate AI output.** Keyless is enforced at three
  layers, not assumed; the paid POSTs fail honestly; the visible drafts are real, captured artifacts
  with truthful review status.
- **Honest about its own limits.** The banner, the `DEMO_DISABLED` copy, the withheld interview-prep
  pack, and the nightly-reset notice all tell the visitor what is and is not live.
- **One-container assumptions are recorded.** The in-memory rate-limit window and the single Neon
  instance are correct because ADR-0022 runs exactly one task; scaling out would require moving the
  window to shared state (named, not built).
- **Fixtures are a maintenance surface.** They drift from the live prompts over time; the refresh is an
  attended re-capture with recorded spend, not an automatic job.
- **The keyless posture composes with ADR-0007 and ADR-0022.** No real data, no LLM key, two
  fictional-data secrets - the smallest safe footprint for a public box.

## Value

- **Product:** a recruiter can log in and explore a real-behaving platform - paste a posting, see it
  render safely, walk reviewed drafts and a computed fit report - without any real data, any spend, or
  any dishonest mock.
- **Skills:** defense-in-depth (env + boot + data fail-closed), a capture/replay pipeline that keeps
  deterministic outputs live while snapshotting the LLM ones, honest rate limiting behind a proxy, and
  a source-byte encoding discipline that preserves a verbatim-match invariant - security and honesty
  engineering, not just a feature flag.
- **Employability:** the demo *is* the portfolio artifact; its semantics show a candidate who ships a
  public system that is safe, honest, and cheap by design, and who wrote down why each rule exists.

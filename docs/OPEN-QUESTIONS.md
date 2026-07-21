# CareerForge — Open Questions

**Status:** Q1, Q3, Q4, Q7 resolved 2026-07-12 · Q5 resolved 2026-07-19 (promoted) · Q2 resolved 2026-07-19 · Q6 default confirmed · **all open questions resolved** · **Last updated:** 2026-07-19

## Still open

_None._

## Resolved

### Q2 · Portfolio domain & branding — **RESOLVED 2026-07-19**

Domain = **`carlosgutz.com`** (operator, **re-decided 2026-07-20**). *Correction (2026-07-20, M2-11): the 2026-07-19 answer named `carlosgutz25.com`, which was **never purchased**; Q2 was re-decided 2026-07-20 as `carlosgutz.com`.* M2-01's deploy is **decoupled from the domain** (ADR-0008 A1): the portfolio ships to the default `*.github.io` URL first and the pipeline is proven there; attaching the custom domain (DNS + repo setting, then drop the `NUXT_APP_BASE_URL` subpath prefix — **no CNAME file: publishing via a custom GitHub Actions workflow ignores and does not require one**, GitHub docs) is a separate later step, since DNS propagation is not under CI control and the week-9 publish deadline is immovable. DNS + email-forwarding choices follow at that step. Recorded in ADR-0008 (amended 2026-07-20) and BACKLOG M2-01/M2-11.

### Q1 · LLM API budget — **RESOLVED 2026-07-12 (default confirmed)**

Anthropic API, $5–20/month budget, usage tracked per run (RISKS T-03). **Action item:** flag Carlos at M1-04 if projected usage exceeds the budget.

### Q3 · Binventory public detail — **RESOLVED 2026-07-12 (default confirmed)**

Architecture write-up plus engineering decisions; all screenshots/content fictionalized or blurred; no real household data.

### Q4 · When applying starts — **RESOLVED 2026-07-12: NOW**

Real applications run manually from **week 1**, in parallel with M0 — applying is not gated on the tool existing. The week-6 gate (M1-13) now verifies the tool is *useful* to the already-active search (≥5 real postings scored, fit reports informing in-flight applications). No new build scope. Reflected in PLAN §3–§6, BACKLOG M1-13, RISKS P-02.

### Q5 · Resume tailoring/export — **RESOLVED 2026-07-19: PROMOTED (decided at the M1 retro, as checkpointed)**

Was iceboxed pending dogfood data; the M1 retro (week 6) held the decision checkpoint. Decided by the operator with the dogfooding data beside it: promoted into a named story — BACKLOG M2-10 (proposed placement after M2-09's publish, ratified at the M1-13 final review). Scope: honest per-posting emphasis/reordering of existing verified profile content, evidence-cited, draft-until-reviewed, never fabrication (standing law). Evidence for promotion: operator dogfood testimony — prep value on all six in-flight applications, want stated unprompted.

### Q6 · Portfolio design direction — **DEFAULT CONFIRMED**

Minimal, typography-led, content-first, AA-contrast light/dark — unless Carlos sends reference sites before week 7.

### Q7 · Employer-sensitivity for case studies — **RESOLVED 2026-07-12: publish the metrics**

The $150k/day (Love's Showers) and $161k/quarter (Nintendo) figures are on the public-facing resume and may be published on the portfolio and in case studies as-is. `docs/profile/projects.md` is confirmed publishable as written (already sanitized). The M2-04 sensitivity check remains in force for any **new** content beyond what projects.md says. Recorded in RISKS L-02.

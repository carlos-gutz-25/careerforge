# ADR-0016: Design system — two identities, one grammar

**Status:** Accepted · **Date:** 2026-07-26

> Numbering note: v2 ADR numbers are assigned at merge order (V2-PLAN section 6).
> 0016 was the lowest free number when this was authored (2026-07-26), claimed by
> renaming the M5-02 `RESERVED-design-system.md` stub.

## Context

v2 gives both frontends a distinctive visual identity (operator decision 5,
V2-PLAN section 1): the public portfolio becomes the "Provenance Ledger" and the
platform UI (`apps/web`) becomes the "Dusk Console". Two apps now need design
tokens, dark-mode handling, typography, and contrast verification. That raises four
questions this ADR answers as one major technical choice: how much do the two apps
share, where does the shared part live, what governs web fonts, and what
accessibility floor is mechanically enforced.

The governing facts are already in force:

- **The portfolio's token grammar and contrast gate exist and work.**
  `apps/portfolio/app/assets/css/tokens.css` holds custom properties where every
  `--color-*` value is a bare `#hex` or strict `light-dark(#hex, #hex)`; nothing
  else parses. `apps/portfolio/tests/tokens-contrast.test.ts` reads that file as
  text, computes WCAG relative luminance inline, and asserts an explicit `PAIRS`
  manifest of `[foreground, background, threshold]` in BOTH modes. Guard (i) fails
  any `--color-*` token in no pair; guard (ii) fails any value outside the grammar;
  a ratchet fails any `--color-*` declared outside tokens.css; a lockstep test fails
  if the `theme-color` metas drift from `--color-bg`. A forgotten dark override is
  unrepresentable by construction.
- **The module wall is a hard rule** (ARCHITECTURE section 2; CLAUDE.md):
  `apps/portfolio` never imports platform packages; the `ANY_INTERNAL` eslint wall
  allows only `@careerforge/config`. The portfolio builds and deploys with zero
  access to private data or the API.
- **Portfolio CI gates are never lowered:** Lighthouse perf ≥ .95, a11y = 1.0
  strict, bp ≥ .95, seo ≥ .95 on home and every case study, plus axe zero-violation
  and the prerender/provenance/link gates.
- **Any change to a verification gate ships a demonstrated planted-FAIL in the same
  change** (CLAUDE.md) — this applies to every new copy of the contrast gate and
  every threshold addition.
- **V2-PLAN ratified the shape already** (operator decisions 5 and 8; section 7):
  two identities, one grammar, no shared package, with the shared
  `@careerforge/design` package recorded as a named v2.1 candidate. This ADR records
  that decision durably with its rationale and reopening trigger; it does not reopen
  it.

This ADR is deliberately scoped: it fixes the SHARED grammar and policies that
govern both apps, plus the portfolio-side sub-decisions already ratified. The
platform's palette, fonts, and component decisions belong to the platform lane's
stories (M8-06 onward) and are not specified here.

## Decision

### 1. Two identities, one grammar

The portfolio ("Provenance Ledger") and the platform UI ("Dusk Console") are
visually distinct identities — different palettes, typefaces, and moods — but share
ONE token grammar and one verification discipline:

- Each app owns a `tokens.css` of custom properties in which every `--color-*` value
  is a bare `#hex` (3- or 6-digit) or strict `light-dark(#hex, #hex)` — no `var()`
  composition, no other color functions, one declaration per line. `light-dark()`
  plus `color-scheme: light dark` makes a missing dark value unrepresentable.
- Each app carries its OWN copy of the text-parse contrast gate (the portfolio's
  `tokens-contrast.test.ts` pattern): PAIRS manifest, guard (i) no-unpaired-token,
  guard (ii) grammar enforcement, the outside-tokens.css ratchet, and the
  theme-color lockstep. Standing up the platform's copy is itself a gate change and
  therefore ships its planted-FAIL in the same change (M8-06).
- Identity content (which hexes, which faces) is per-app and per-lane; the grammar
  and the gate discipline are the shared contract. This ADR does not specify the
  Dusk Console's palette or fonts.

### 2. No shared package now, with a named v2.1 reopening trigger

A shared `packages/design` is REJECTED for v2. Each app duplicates the grammar and
the gate.

- **The module wall decides it.** `apps/portfolio` imports no platform packages
  (only `@careerforge/config`). A shared design package would either breach that
  wall or complicate it with a second carve-out, coupling the public zero-backend
  site to platform-side release cadence for the sake of one small CSS file and one
  ~200-line test.
- **Two consumers is below the abstraction bar.** The duplicated surface is a
  tokens.css (whose values differ per identity anyway — only the grammar is common)
  and a self-contained test with inline WCAG math and zero dependencies. Each copy
  is independently verified by its own CI; drift between copies cannot silently
  break either app.
- **Reopening trigger (v2.1, recorded in the ledger):** a THIRD frontend appears, or
  MEASURED drift pain between the two copies (a real defect or friction traced to the
  duplication, not aesthetic discomfort with it). Until one fires, duplication is
  the correct cost.

### 3. Font self-hosting policy (portfolio)

- **Display face:** self-hosted variable Fraunces, latin subset, budget ≤ 40KB. The
  prepared subset (authoring-time measured): 34308 bytes woff2, `wght` kept variable
  100..900, `opsz` PINNED at 144 (the display optical cut — keeping opsz variable
  measured 66.5KB, over budget), quirk axes SOFT and WONK dropped (WONK pinned 0).
  The face's natural default weight is 900, so the `@font-face` declares
  `font-weight: 100 900` and every consumer sets an explicit weight; the design
  system never leaves weight unset.
- **Loading:** `<link rel="preload">` for the woff2, plus a metric-adjusted local
  fallback (`size-adjust` / `ascent-override` / `descent-override` computed from the
  subset's own metrics) so the swap does not shift layout.
- **Body:** a tuned system font stack (no second webfont). **Eyebrows and provenance
  stamps:** monospace stack.
- **Abort-to-system-stack ramp:** M8-03 records Lighthouse 3-run medians before and
  after in the PR. If the median performance score drops below 96, the Fraunces
  display face is DROPPED back to the system stack. Budgets are never lowered: the CI
  floor stays at .95 untouched, and the 96 ramp sits above it so the typeface is
  sacrificed before the budget is ever at risk. The font is a want; the gate is a
  law.
- Google Fonts CDN hosting is rejected: a third-party request on a privacy-conscious
  site, no subsetting control, and a render-path dependency the budget does not need.

### 4. PAIRS threshold policy — and no decorative tier

- Every `--color-*` token MUST participate in at least one PAIRS entry with an
  explicit threshold (guard (i) makes this unskippable). Two thresholds exist:
  **4.5:1** for text pairs (WCAG 1.4.3 AA), constant `AA_TEXT`; **3:1** for UI
  indicators and structural hairlines (WCAG 1.4.11 / 2.4.13), constant
  `UI_INDICATOR`.
- Every pair is asserted in BOTH modes; the `light-dark()` grammar guarantees both
  mode values exist to assert.
- **No decorative tier.** There is no sub-3:1 threshold slot, and none will be added:
  WCAG 1.4.11 would exempt a purely decorative element, but adding an exempt tier
  would weaken a verification gate, and in these identities the hairlines carry
  structure (they delimit ledger rows and provenance blocks), so contrast-bearing is
  the honest classification. A token that cannot meet its pair's threshold is
  RE-CHOSEN, never exempted.
- **Worked example (ratified sub-decision, 2026-07-26):** the drafted Provenance
  Ledger hairline `light-dark(#8f8b7e, #565b63)` fails 3:1 against surface in light
  mode (2.91) and against both bg (2.63) and surface (2.42) in dark mode, verified
  with the gate's own luminance math. The ADOPTED token, hue preserved, clears 3:1 on
  both bg and surface in both modes:

  ```css
  --color-hairline: light-dark(#8c887c, #656a71);
  ```

  Measured: light 3.25 (bg) / 3.03 (surface); dark 3.29 (bg) / 3.03 (surface). M8-02
  lands this value plus its two PAIRS entries (`hairline` on `bg` and on `surface`,
  both at `UI_INDICATOR`), and exercises the planted-FAIL by temporarily reverting to
  the drafted hexes, showing the gate go red, then restoring. This supersedes the
  draft hairline value in the lane charter's aesthetic-direction line.

## Alternatives considered

- **Shared `packages/design` now** — rejected: breaches or complicates the portfolio
  module wall, couples two lanes at two consumers for a tiny duplicated surface;
  recorded as the named v2.1 candidate with the trigger above.
- **One shared identity for both apps** — rejected: different audiences (a public
  hiring-manager document vs a private dark-first operator console); operator
  decision 5 chose two identities.
- **A third-party design system or utility framework** — rejected: a templated look
  defeats the distinctive-identity goal, and dependency weight works against
  never-lowered Lighthouse budgets.
- **CDN-hosted fonts** — rejected (third-party request, no subset control).
- **Fraunces with variable `opsz`** — rejected on measurement: 66.5KB, over budget; a
  display-only face is correctly served by one pinned optical cut. (Also measured and
  rejected: static wght=600 at 17.4KB, loses variability; wght 300-700 at 33.3KB,
  barely smaller, loses range.)
- **A decorative sub-3:1 contrast tier** — rejected: weakens a verification gate, and
  these hairlines are structural.

## Consequences

- **M8-02** lands the Provenance Ledger palette in `apps/portfolio` tokens.css
  (including `--color-hairline: light-dark(#8c887c, #656a71)` and the new
  surface/hairline/stamp tokens), adds each new token to the `PAIRS` manifest with
  its threshold, updates BOTH `nuxt.config.ts` `theme-color` metas in lockstep with
  `--color-bg`, and ships two planted-FAILs in the same change (an AA-failing hex; a
  stale theme-color meta).
- **M8-03** self-hosts the Fraunces subset (adds a `fonts.css` + `<link rel=preload>`
  + the metric-adjusted `@font-face` fallback), records Lighthouse 3-run medians
  before and after in the PR, and applies the abort-to-system-stack ramp if the
  median performance score drops below 96.
- **The platform lane** stands up `apps/web`'s own tokens.css and contrast-gate copy
  under the Dusk Console identity (M8-06); that is a gate change and ships its own
  planted-FAIL (the real `#888` defect). Its palette and fonts are decided in its own
  stories, not here.
- **No shared package is created.** The v2.1 reopening trigger (a third frontend, or
  measured drift pain) is recorded for future revisit; until then the duplication is
  the accepted cost and the module wall is unchanged.

## Value

- **Product:** both frontends get distinctive, coherent identities whose
  accessibility floor (AA text, 3:1 indicators, both modes) is mechanically enforced
  by per-app gates that cannot be dodged, with typography that cannot cost the
  performance budget (the abort ramp fires before the gate can).
- **Skills:** demonstrates design-token architecture with an enforceable grammar,
  WCAG 1.4.3/1.4.11 applied as test thresholds rather than aspirations, measured
  variable-font subsetting (axis pinning, budget-driven trade-offs), and the
  discipline to reject a shared package at two consumers with a recorded reopening
  trigger.
- **Employability:** a senior-level design-system story backed by measured numbers
  (34.3KB subset, 3.03:1 worst-case hairline) instead of taste claims.

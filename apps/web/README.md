# apps/web — platform UI (Nuxt 4, SPA mode)

The authenticated CareerForge UI. **SPA mode (`ssr: false`) is deliberate**
(ADR-0001): one authenticated user behind login means SSR buys nothing, and a
pure SPA keeps the API boundary clean — **all data flows through `apps/api`;
Nitro server routes carry no platform business logic** (module-boundary rule,
ARCHITECTURE §2). SPA-mode Nuxt is slightly unusual; the consequences that
matter live in this file.

## Running it

```sh
pnpm dev       # from the repo root: apps/api on http://localhost:4301
pnpm dev:web   # this app on http://localhost:4300
```

The 4300/4301 pair is deliberate: Binnie — a permanent local service —
owns :3000 and its neighborhood. The dev origin (`http://localhost:4300`)
must match the API's `WEB_APP_ORIGIN`: that single env var drives both the
CORS allowlist and the CSRF origin check. The API base URL is
`runtimeConfig.public.apiBase` (default `http://localhost:4301`, override
with `NUXT_PUBLIC_API_BASE`).

> **Port collision is ENFORCED, not just documented (M0-10 finding → M1-01
> enforcement):** Nuxt/listhen has no strict-port option — if the port is
> taken, `nuxt dev` silently picks another, the browser origin stops matching
> `WEB_APP_ORIGIN`, and every mutation 403s undiagnosably. The dev script
> therefore runs a preflight (`scripts/assert-port-free.mjs`) that **refuses
> to start when :4300 is taken**, with a message naming the fix: free the
> port, or change `devServer.port` + the preflight argument +
> `WEB_APP_ORIGIN` **together**.

## How auth works client-side

- The session lives in an **HttpOnly `cf_session` cookie** — invisible to JS
  by design, so the server is the only source of truth for "am I logged in".
  The global middleware (`app/middleware/auth.global.ts`) resolves it via
  `GET /auth/me` once per app load; afterwards the answer is client state
  (`useSessionUser`).
- **Default-deny, mirrored:** every route requires auth unless the guard says
  otherwise (today the only exception is `/login`) — the same opt-out posture
  as the API's root guard.
- **401 handling:** any 401 outside `POST /auth/login` means the session is
  absent, expired, or revoked. The API client's response interceptor
  (`app/composables/use-api.ts`) clears auth state and redirects to
  `/login?redirect=<current-location>`. A login 401 is a wrong password and
  stays with the form. There is no client-side session timer — expiry simply
  manifests as the next request's 401.
- **`?redirect=` is validated** (`app/utils/safe-redirect.ts`): only internal
  paths are honored; absolute URLs, protocol-relative `//host` forms, and
  non-strings fall back to `/` (open-redirect defense, pinned by tests).

## CSRF posture (ADR-0007, client half)

The API's protection is `SameSite=Lax` **plus an exact Origin check on every
mutating request** against `WEB_APP_ORIGIN`. The browser attaches the
`Origin` header to fetch mutations on its own — the SPA sends **no CSRF
token** and never will under this posture. The invariant that keeps it sound:
**GETs never mutate** — never route a state change through a GET, here or in
the API.

## Escape discipline

Rendering is `{{ interpolation }}` only. `vue/no-v-html` is an ESLint
**error** repo-wide (law, not preference). Since M1-02, hostile job-posting
text renders on the posting detail page: interpolation into a `<pre>` with
`white-space: pre-wrap` — newlines survive via CSS, **never** via `\n → <br>`
conversion (which requires `v-html` and is the road back to XSS). Posting
text has exactly ONE rendering path (the detail page) fed by exactly ONE
response (`GET /postings/:id`); the paste form never re-displays textarea
contents as saved content.

## Design tokens & theming (M8-06, ADR-0016 "Dusk Console")

- **One source of truth for color:** `app/assets/css/tokens.css` holds every
  `--color-*` token in the strict grammar — a bare `#hex` or
  `light-dark(#light, #dark)`, one declaration per line, no `var()`
  composition or other color functions. `base.css` consumes them and declares
  **no** color token; a ratchet in `tests/tokens-contrast.test.ts` FAILs on any
  `--color-*` defined outside `tokens.css`.
- **The contrast gate** (`tests/tokens-contrast.test.ts`) is `apps/web`'s own
  copy of the portfolio gate (ADR-0016 §1 — two identities, one grammar; no
  shared package). It reads `tokens.css` as text and does inline WCAG math: a
  PAIRS manifest asserts every pair in **both** light and dark at its threshold
  (`AA_TEXT` 4.5:1 for text, `UI_INDICATOR` 3:1 for the focus ring and
  hairlines — no decorative tier), guard (i) fails any unpaired token, guard
  (ii) fails any grammar violation, and a lockstep check fails if the
  `nuxt.config.ts` `theme-color` metas drift from `--color-bg`. A missing dark
  value is unrepresentable by the grammar. **Adding a token = adding its PAIRS
  entry**, or guard (i) goes red.
- **Three-state theme toggle** (`app/composables/use-theme.ts` +
  `AppThemeToggle.vue`): system / light / dark, written to `<html data-theme>`
  (which pins `color-scheme`, which `light-dark()` resolves against) and
  persisted in localStorage. `system` clears the attribute so `tokens.css`'s
  `color-scheme: light dark` follows the OS.
- **Fonts:** `--font-ui` / `--font-mono` use system/generic stacks today;
  self-hosting the IBM Plex Sans + JetBrains Mono subsets is a deferred
  follow-up (parked — a separate story, as the portfolio's Fraunces is M8-03).

### Shell & primitives (M8-07)

- **Sidebar shell** (`layouts/default.vue`): the authenticated layout is a
  four-section sidebar (Search / Growth / Publish / Profile). Search groups the
  live surfaces (Postings, Applications, Search criteria); Growth and Publish
  render as muted "Coming soon" until their pages land (M8-11+). The brand is a
  non-heading `<strong>` on purpose (a second `<h1>` would collide with page
  headings the e2e pins), and a link accessibly-named exactly **"Postings"** is
  a load-bearing contract of `e2e/postings-xss.spec.ts` — never rename it.
- **UI primitives** (`app/components/App*.vue`): `AppPanel` (surface|quote tone,
  optional `scroll`), `AppStateChip` (neutral/draft/reviewed/danger/info — each
  variant is one of the contrast gate's VERIFIED strong-on-`-bg` pairs, so chips
  are AA in both modes by construction), `AppEmptyState` (message + optional
  `#action` slot), `AppSkeleton` (shimmer bars for the 10-20s LLM waits,
  `aria-hidden`, frozen by the reduced-motion kill switch). They are the shared
  vocabulary for new feature UI; existing components were restyled off raw hex
  **in place** (not refactored onto the primitives) to keep every data-testid
  and the 14 vitest contract files unchanged.
- **No raw hex:** every component/page color resolves to a `--color-*` token;
  solid badges became subtle semantic chips (no white token exists, and white
  fails dark-mode contrast). The M8-08 ratchet (`tests/no-raw-hex.test.ts`)
  enforces this: it reads every `.vue` under `app/` as text and FAILs on any
  raw hex literal (`#rgb`/`#rrggbb`/4-/8-digit) inside a `<style>` block, so a
  new color literal cannot re-open the sprawl the token layer closed. (Scope is
  hex only, per the story name; `tokens.css`/`base.css` are `.css`, not scanned
  here — the contrast gate owns them.)

### Surfaces (M8-09)

- **Command Center** (`pages/index.vue`, route `/`): the platform home. A
  dashboard composed ENTIRELY from existing list endpoints (no new API) —
  application pipeline (by stage), posting inventory (by status), a criteria-
  tuning signal, recent activity, and quick actions. `AppSkeleton` while
  loading, `AppEmptyState` per empty panel. V2-PLAN's "drafts awaiting review"
  and "due exercises" are deferred (no aggregate endpoint; exercises API lands
  M8-12) — documented in the page.
- **Evidence Library** (`pages/evidence.vue`, route `/evidence`): the profile
  view relocated off `/` and reframed as the evidence base fit scoring cites
  (skills / experience / projects). The sidebar Profile group links it as
  "Evidence Library". No new endpoint — still `GET /profile`.

### Opportunity Workspace (M8-10)

- **`pages/postings/[id].vue`**: the posting detail page presents the
  opportunity lifecycle as six staged tabs — **Capture → Extract → Score →
  Gaps → Prepare → Track** — a `role="tablist"` with roving-tabindex keyboard
  nav (Arrow/Home/End). Inactive panels stay in the DOM behind the `hidden`
  attribute (WAI-ARIA tab pattern), not `v-if`: every relocated `data-testid`
  stays reachable and the rendering-law surfaces stay present. **Capture is the
  default**, so the untrusted posting text (`posting-raw`, still a `<pre>` under
  the `{{ }}`-only escape discipline above) renders on first load — the e2e
  visibility contract. The stages regroup existing surfaces only (zero new API
  calls): Extract adds a collapsible **Run Evidence** `<details>` around the
  extraction telemetry (the LLM run's model / prompt / tokens / latency);
  downstream stages show `AppEmptyState` guidance until their prerequisite (an
  extraction run, a fit report) exists. Prep surfaces land inside the Prepare
  stage: `ResumeVariantSection` and (M8-11) `InterviewPrepSection`; the M7-09
  gameplan lands there too (M8-10 merges before M7-09 by the sequence rule).

### Interview prep (M8-11)

- **`components/InterviewPrepSection.vue`** (Prepare stage): the M3-04
  interview-prep UI, following the resume-variant / improvement-plan
  pin-to-report pattern (`getInterviewPrep` / `draftInterviewPrep` /
  `reviewInterviewPrep` on `use-api.ts`). A review-gated, fire-once draft
  trigger (the posting's latest fit report must be reviewed); per-question
  render with two talking-point shapes — **evidence** (strength + posting/profile
  quotes in a `<details>` expander) and **gap_disclosure** (the gap row's live
  `gapClassification` badge, server-resolved — the honesty signal, never the
  model's word — plus learning-plan pointer links); a one-shot draft→reviewed
  form; and a collapsible **Run Evidence** panel. All question / point / quote
  text is `{{ }}`-only untrusted (same escape discipline as `posting-raw`).

### Growth — Learning plans (M8-12, sliced)

- The sidebar **Growth** group links **Learning plans** (`/learning-plans`),
  un-stubbing the M8-07 "Coming soon" placeholder. **`pages/learning-plans/
  index.vue`** lists the user's plans (meta-only: title link, review chip, gap
  count — plural by design, ADR-0013); **`pages/learning-plans/[id].vue`** is
  the plan detail: cited gaps (focus + requirement + live `gapClassification` +
  priority), read-only exercises (title/kind/status + gap & evidence counts), a
  one-shot draft→reviewed form, a collapsible **Run Evidence** panel, and a 404
  state. Title / focus / notes / exercise titles are `{{ }}`-only untrusted.
  Client methods: `listLearningPlans` / `getLearningPlan` / `createLearningPlan`
  / `reviewLearningPlan` on `use-api.ts`.
- **Create a plan from gaps** (slice 2): the Gaps stage of the Opportunity
  Workspace renders `CreateLearningPlanSection.vue` below the gap classifier —
  it offers this report's actionable (non-`have`) gaps as a checklist (all
  selected by default), and a fire-once paid **Draft learning plan** trigger
  calls `createLearningPlan({ gapIds })` and navigates to the new plan on
  success. It is review-gated (the fit report must be reviewed — the server
  409s otherwise, so the client shows a gate instead of firing), a
  citation-flagged run (201 with `plan: null`) surfaces as a loud banner, and
  the requirement text renders `{{ }}`-only untrusted.
- **Exercises CRUD** (slice 3, M3-02): the plan-detail exercises section is
  editable — an **Add an exercise** form (user-authored title, one of four
  kinds, a checklist of the plan's cited gaps it addresses → `createExercise`),
  a per-exercise **status** select (planned / in_progress / complete →
  `updateExerciseStatus`; marking `complete` without implemented+tested
  evidence 409s, surfaced as received — that evidence UI is slice 4), and a
  **Delete** button (`deleteExercise`, the mis-create recourse). The kind /
  status option vocab is a local typed list pinned complete against core's
  enums by test (the GapSection LADDER pattern). Titles render `{{ }}`-only
  untrusted. Client methods: `createExercise` / `updateExerciseStatus` /
  `deleteExercise` on `use-api.ts`.
- **Mastery evidence** (slice 4, M3-03): each exercise lists its evidence (kind,
  date, artifact) with a **Record evidence** form (one of four kinds; optional
  artifact URL + date, omitted when blank so the server defaults the date →
  `createMasteryEvidence`) and a **Remove** button (`deleteMasteryEvidence`;
  the server delete-guard 409s when removing the last implemented/tested
  evidence of a `complete` exercise, surfaced as received). A per-exercise
  **completion hint** shows whether it has the implemented + tested evidence the
  M3-03 gate requires before `complete`. The `artifactUrl` is user-authored and
  UNTRUSTED — rendered as **escaped text, never an `<a href>`** (a
  `javascript:`/`data:` URL in an href is the classic bypass of the `{{ }}`
  rendering law). Evidence-kind vocab is a local typed list pinned complete
  against core's `EVIDENCE_KINDS` by test. This completes M8-12.

### Growth — Review queue (M8-13, M3-05)

- The sidebar **Growth** group also links **Review queue** (`/review-queue`).
  **`pages/review-queue/index.vue`** surfaces the spaced-review projection: the
  DUE revisits over the user's completed exercises, recomputed from the server
  clock on every GET (nothing is stored, so nothing goes stale), soonest-due
  first by API contract. Each item shows the exercise title (a link to its
  parent learning plan, where the revisit is recorded), its kind, and — as mono
  evidence surfaces — the due date, the completion date, the upcoming revisit
  number, and the current interval. Titles are user-authored and `{{ }}`-only
  untrusted. The one action, **Mark revisited**, records the existing
  mastery-evidence with kind `'revisited'` (`createMasteryEvidence`) and
  re-fetches — the ladder recomputes and the item advances to its next, longer
  interval (or graduates), leaving the due list; a failed action surfaces its
  error and never silently drops the item. Skeleton while loading, empty state
  when nothing is due. Client method: `getReviewQueue` on `use-api.ts`.

### Publish — Case studies (M8-14, M4-01, slice 1)

- The sidebar **Publish** group links **Case studies** (`/case-studies`),
  un-stubbing the M8-07 "Coming soon" placeholder. **`pages/case-studies/
  index.vue`** lists the user's case-study drafts (a picker — `renderedMarkdown`
  omitted by API contract) with each draft's title (a link to its detail), its
  draft/published status chip, provenance, and updated date. **`pages/case-
  studies/[id].vue`** shows one draft: title, status, provenance, source
  exercise, and the **rendered markdown body**. **RENDERING LAW (M1-02):** the
  markdown is user/template-derived and UNTRUSTED — rendered as ESCAPED TEXT in
  a `<pre>` (mono, pre-wrap), NEVER parsed as HTML/markdown (the postings-raw
  precedent; `v-html` is lint-banned); title / exerciseTitle are `{{ }}`-only
  untrusted. Draft actions: **Refresh from evidence** (re-POST — re-renders the
  draft from the exercise's latest evidence, keeping the current title; shown
  only while the source exercise still exists and the stored provenance is a
  wire-creatable value, hidden once published), **Publish** (the one-way CAS
  flip draft→published that locks refresh), **Export markdown** (a browser
  download of the raw stored markdown, same raw-fetch→Blob→anchor helper as the
  resume export — no status gate, the draft IS the product), and **Delete** (the
  mis-publish recourse, returns to the list). A missing draft is a 404
  not-found state. Client methods on `use-api.ts`: `listCaseStudies`,
  `getCaseStudy`, `createCaseStudy`, `publishCaseStudy`, `deleteCaseStudy`,
  `exportCaseStudy`. **Create affordance (slice 2):** on the learning-plan
  detail (`pages/learning-plans/[id].vue`), each **`complete`** exercise carries
  a **Draft case study** control (a provenance select over the wire subset
  `personal` / `personal_ai_assisted`) that calls `createCaseStudy({ exerciseId,
  provenance })` and navigates to the new draft. It is gated on the exercise
  being `complete` client-side (the server re-derives completion — the control
  is an affordance only), and a failed draft surfaces its error without
  navigating. This is the entry point that produces the drafts the list and
  detail above manage.

### Profile — Skills & upgrades (M8-15, M3-06)

- The sidebar **Profile** group links **Skills & upgrades** (`/skills`) beside
  Evidence Library. **`pages/skills/index.vue`** carries two deterministic,
  LLM-free projections (the review-queue / criteria-suggestions class).
  **Suggested upgrades** (`GET /skill-upgrade-suggestions`, recomputed per
  request — nothing stored): completed, fully-evidenced exercises whose evidence
  would earn a profile skill a `solid` grant, each shown with the skill's level
  transition and the backing exercises + their matched requirements; a
  per-exercise **Confirm upgrade** posts only the two ids (`profileSkillId`,
  `exerciseId`) — the server re-derives the whole grant, so the button is a pure
  affordance — then re-fetches both lists. **Upgrade history**
  (`GET /skill-upgrades`, the audit view): every grant, active + revoked, with
  its level transition, status chip (active=green, revoked=neutral), evidence
  trail, and the derived **detached** danger flag (an active grant whose skill
  name no longer exists in the profile — the signal to revoke or re-earn); an
  active grant offers **Revoke** with an optional note (blank sends `null`, never
  `''`), which re-fetches both lists. **SECURITY (S-02):** skill / requirement /
  exercise / artifact text are user/posting-derived and UNTRUSTED — rendered via
  `{{ }}` only, and `artifactUrl` is escaped TEXT, never an `<a href>` (the
  mastery-evidence hardening precedent). The level / evidence-kind / status
  display vocab are LOCAL typed `Record<Enum, …>` maps, pinned complete against
  core's `SKILL_LEVELS` / `EVIDENCE_KINDS` / `UPGRADE_STATUSES` by test (the
  GapSection LADDER precedent — keeps core's zod out of the bundle). One action
  is in flight at a time; a failed action surfaces its error and never drops the
  item. Client methods on `use-api.ts`: `getSkillUpgradeSuggestions`,
  `createSkillUpgrade`, `listSkillUpgrades`, `revokeSkillUpgrade`.

## Testing & typecheck

- `pnpm test` (root) runs this workspace's vitest project: runtime tests use
  the `nuxt` environment (`@nuxt/test-utils`); pure utilities opt down to
  node per-file. The auth guard's component test is the M0-10 acceptance
  criterion.
- `pnpm typecheck` runs `nuxt typecheck` (vue-tsc). `tsconfig.json` extends
  the **generated** `.nuxt/tsconfig.json` (Nuxt convention — a documented
  deviation from `@careerforge/config/tsconfig.base.json`).
- `pnpm test:e2e` (root or here) runs the Playwright suite in `e2e/` —
  currently the M1-02 XSS regression (live payload through the real form,
  rendered in real chromium, asserted inert). Vitest excludes `e2e/`;
  Playwright owns it. Harness facts:
  - **Dedicated ports** 4310 (web) / 4311 (api) by default — never collides
    with the 4300/4301 dev stack; `reuseExistingServer: false` is the loud-fail
    if a port is squatted. Overridable per git worktree via `E2E_WEB_PORT` /
    `E2E_API_PORT` so parallel lanes run e2e concurrently (M5-03; defaults
    unchanged) — `playwright.config.ts` reads the origins from `e2e/e2e-env.mjs`
    so config and servers stay in lockstep.
  - **Scratch DB** `careerforge_e2e` by default (derived from `DATABASE_URL`
    like `_test`; overridable per worktree via `TEST_DB_SUFFIX`, or
    `E2E_DATABASE_URL` for a whole other server): recreated +
    migrated by `serve-api.mjs` at server boot (NOT a Playwright globalSetup —
    webServers start before globalSetup runs), dropped in global teardown. Every
    run is clean-slate. Credentials are fictional throwaways baked into
    `e2e/e2e-env.mjs`. See docs/RUNBOOKS.md for the parallel-worktree recipe.
  - **Retries are CI-only** (`retries: 2`, trace on first retry): e2e rides
    the required `test` check, so CI absorbs one-off flakes; locally retries
    are 0 so flake stays loud. Split trigger (BACKLOG ledger): >~5 specs or
    >3 min added to the CI job → e2e graduates to its own job/check.
  - The web side runs `nuxt dev` (not build+preview): dev applies
    `NUXT_PUBLIC_*` runtime overrides deterministically. First run needs
    chromium: `pnpm --filter @careerforge-app/web exec playwright install chromium`.

## Privacy (RISKS P-01)

Dev against the real local DB is fine for your own eyes. **Anything captured
— screenshots, recordings, demo artifacts — uses the example profile only**
(`pnpm profile:import --example` into a scratch DB). Tests use fictional
identities exclusively.

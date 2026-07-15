# apps/web — platform UI (Nuxt 4, SPA mode)

The authenticated CareerForge UI. **SPA mode (`ssr: false`) is deliberate**
(ADR-0001): one authenticated user behind login means SSR buys nothing, and a
pure SPA keeps the API boundary clean — **all data flows through `apps/api`;
Nitro server routes carry no platform business logic** (module-boundary rule,
ARCHITECTURE §2). SPA-mode Nuxt is slightly unusual; the consequences that
matter live in this file.

## Running it

```sh
pnpm dev       # from the repo root: apps/api on http://localhost:3001
pnpm dev:web   # this app on http://localhost:3000
```

The dev origin (`http://localhost:3000`) must match the API's
`WEB_APP_ORIGIN`: that single env var drives both the CORS allowlist and the
CSRF origin check. The API base URL is `runtimeConfig.public.apiBase`
(default `http://localhost:3001`, override with `NUXT_PUBLIC_API_BASE`).

> **Port footgun (found during the M0-10 smoke):** if something else already
> holds :3000, `nuxt dev` silently picks another port — and every mutation
> then fails CORS/CSRF because the browser origin no longer matches
> `WEB_APP_ORIGIN`. If logins 403 mysteriously, check the port banner first;
> free :3000 or change the port and `WEB_APP_ORIGIN` **together**.

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
**error** repo-wide (law, not preference): M1-02 renders hostile job-posting
text, so the discipline starts now, on friendly data.

## Testing & typecheck

- `pnpm test` (root) runs this workspace's vitest project: runtime tests use
  the `nuxt` environment (`@nuxt/test-utils`); pure utilities opt down to
  node per-file. The auth guard's component test is the M0-10 acceptance
  criterion.
- `pnpm typecheck` runs `nuxt typecheck` (vue-tsc). `tsconfig.json` extends
  the **generated** `.nuxt/tsconfig.json` (Nuxt convention — a documented
  deviation from `@careerforge/config/tsconfig.base.json`).

## Privacy (RISKS P-01)

Dev against the real local DB is fine for your own eyes. **Anything captured
— screenshots, recordings, demo artifacts — uses the example profile only**
(`pnpm profile:import --example` into a scratch DB). Tests use fictional
identities exclusively.

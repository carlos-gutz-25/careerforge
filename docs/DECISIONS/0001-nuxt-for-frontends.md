# ADR-0001: Nuxt 4 for Both Frontends

**Status:** Proposed · **Date:** 2026-07-12

## Context

The project constraint is "Vue/Nuxt frontend, TypeScript throughout." Two frontends exist with different needs: the platform UI (`apps/web`, an authenticated data-heavy app) and the portfolio (`apps/portfolio`, a public content site where accessibility, performance, and SEO are themselves the product). The open question was plain Vue 3 + Vite vs. Nuxt, and whether both apps should share a framework.

## Decision

Nuxt 4 (Vue 3, TypeScript) for both apps.

- `apps/web` runs in SPA mode (`ssr: false`). It sits behind auth with a single user, so SSR buys nothing; SPA mode keeps the API boundary clean — all data flows through `apps/api`, never through Nuxt server routes.
- `apps/portfolio` uses full static generation (`nuxt generate`) with Nuxt Content for case studies. No runtime backend; deployable to any static host.
- Nitro server routes are **not** used for platform business logic. The Fastify API (ADR-0002) is the only backend.

## Alternatives Considered

- **Plain Vue 3 + Vite (no meta-framework):** closest to Carlos's Heartland experience, fully sufficient for `apps/web`. Rejected because the portfolio genuinely needs SSG/SEO/routing conventions, and running two different Vue setups doubles config surface without teaching anything new.
- **Astro for the portfolio:** excellent SSG, but introduces a second framework and dilutes the "senior Vue ecosystem depth" narrative. The portfolio should demonstrate mastery of the ecosystem Carlos is hired for.
- **Next.js/React:** Carlos has React experience, but the constraint and the strongest resume evidence (Vue 3/Pinia/Vite at Heartland) point to Vue. React remains an "acceptable adjacent area" per job-criteria, not the lead story.

## Consequences

- One framework, one mental model, shared conventions across both apps; Nuxt Content gives the case-study pipeline (markdown → typed content → SSG) for free.
- Nuxt adds a layer of convention over the Vite setup Carlos knows; SPA-mode Nuxt is slightly unusual and must be documented in the app README.
- Risk: Nuxt server features tempting business logic into the frontend — mitigated by the module-boundary rule (ARCHITECTURE.md §2).

## Value

- **Product:** SSG portfolio with content pipeline and first-class perf/SEO; consistent DX across apps.
- **Skills:** extends existing Vue 3/Pinia/Vite depth into the meta-framework layer (routing conventions, SSG, hybrid rendering).
- **Employability:** "Vue 3 + Nuxt" matches how senior Vue roles are actually advertised; the portfolio itself becomes verifiable evidence of Nuxt + performance + a11y craft.

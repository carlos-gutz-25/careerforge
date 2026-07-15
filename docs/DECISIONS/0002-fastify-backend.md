# ADR-0002: Fastify for the API

**Status:** Accepted · **Date:** 2026-07-12 · **Accepted:** 2026-07-14 (M0-09 landed the fastify-type-provider-zod + OpenAPI wiring — the schema-first promise below is now implemented, not planned)

## Context

The backend must be Node.js + TypeScript with input validation at every boundary (zod), structured logging (pino), documented API, and clean routes → services → repositories layering. Carlos's professional experience is Express and Koa. The candidates: keep Express, use Koa, adopt Fastify, adopt NestJS, or use Nuxt's Nitro server routes.

## Decision

Fastify as a standalone API app (`apps/api`).

- **pino is Fastify's native logger** — structured JSON logging with request IDs comes built in, matching the project convention instead of being bolted on.
- **Schema-first routes:** with `fastify-type-provider-zod`, every route declares zod schemas for params/body/response; validation, TypeScript inference, and OpenAPI generation all derive from one source of truth. "Zod at every boundary" becomes the path of least resistance rather than discipline.
- **Plugin encapsulation** maps naturally onto modular-monolith boundaries: postings, fit, applications, accelerator each register as a plugin with their own scope.

## Alternatives Considered

- **Express:** Carlos's deepest experience, huge ecosystem. Rejected as the lead choice: validation/typing/OpenAPI all require third-party glue and discipline; and the resume already proves Express — repeating it adds no new evidence.
- **Koa:** minimal and familiar, but even more assembly required than Express and a shrinking market presence.
- **NestJS:** strong hiring signal in enterprise, but its DI/decorator framework hides the fundamentals this project is supposed to demonstrate, and it's a large conceptual dependency for a single-developer product.
- **Nuxt Nitro server routes:** fewest moving parts, but couples the API to the frontend, muddies the layering story, and weakens the "standalone documented API" evidence.

## Consequences

- One new framework to learn — deliberately, since Fastify concepts (hooks, plugins, decorators) transfer and the learning is part of the point.
- OpenAPI docs, validation, and logging conventions come nearly free, which buys back the learning time.
- If Fastify ever became the wrong choice, the routes → services → repositories layering keeps business logic framework-agnostic; only the route layer would be rewritten.

## Value

- **Product:** faster, safer API development — single-source-of-truth schemas mean fewer classes of bugs and always-current docs.
- **Skills:** modern Node.js service design beyond the Express era; schema-driven API development is a transferable senior pattern.
- **Employability:** "Express, Koa, **and** Fastify" reads as breadth-plus-currency; the repo demonstrates the migration-of-mindset (middleware → plugins/hooks) that interviewers probe for.

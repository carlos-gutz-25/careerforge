# ADR-0003: PostgreSQL 16 + Drizzle ORM

**Status:** Proposed · **Date:** 2026-07-12

## Context

PostgreSQL is a project constraint (and the right call regardless: relational integrity fits an evidence-linked domain model, and Postgres is the highest-frequency database in Carlos's target postings). The open decision is the data-access layer. Carlos's binventory project already demonstrates Prisma + SQLite; professionally he's worked with Snowflake and Redis but wants deeper explicit-SQL evidence for data-intensive roles.

## Decision

Drizzle ORM with drizzle-kit migrations.

- Schema defined in TypeScript, migrations generated as **plain SQL files, checked into the repo, forward-only** — readable in review, honest in git history.
- Drizzle's query API stays close to SQL (joins, CTEs, aggregations are visible, not conjured), so the repository layer demonstrates actual SQL thinking.
- Repositories in `packages/db` are the only module touching Drizzle; services depend on repository interfaces (project layering rule).

## Alternatives Considered

- **Prisma:** productive and already evidenced in binventory. Rejected here: heavier runtime, more abstracted migration story, and — decisively — it would duplicate existing portfolio evidence instead of adding SQL-depth evidence.
- **Kysely:** excellent type-safe query builder, but schema/migration tooling is thinner; drizzle-kit's generate-SQL-from-schema-diff workflow is more complete for a solo project.
- **Raw `pg` + hand-written SQL:** maximum SQL credibility, but slow for a 12-week roadmap and easy to do sloppily (no type inference on results without extra tooling).

## Consequences

- Reviewable SQL migrations and near-SQL queries make the data layer itself portfolio material.
- Drizzle is younger than Prisma; occasional API churn is possible — contained by the repository boundary.
- Some Prisma conveniences (studio, nested writes) are given up; `drizzle-kit studio` and explicit transactions cover the need.

## Value

- **Product:** an evidence-linked relational model (requirements ↔ evidence ↔ gaps ↔ plans) with real foreign keys and constraints, which is exactly what the honesty guarantees depend on.
- **Skills:** deliberate relational modeling and explicit SQL against Postgres — complementing, not repeating, the Prisma evidence in binventory and the Snowflake experience at Heartland.
- **Employability:** "PostgreSQL or Snowflake-backed applications" is literally on the target-role list in job-criteria.md; this repo becomes the public proof.

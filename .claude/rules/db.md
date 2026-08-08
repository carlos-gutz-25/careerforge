---
paths: ["packages/db/**"]
---

# packages/db — rules

- Only `packages/db` contains SQL/Drizzle. Routes → services → repositories;
  no SQL in routes or services.
- Migrations: drizzle-kit generated SQL (`pnpm db:generate`), checked in,
  forward-only. Definition of done for schema changes includes the migration
  in the same change.
- Any task touching DB schema or migrations: plan mode first.
- Integration tests run against dockerized Postgres (`docker compose up -d`)
  using the derived careerforge_test DB and fail fast when it's down; e2e uses
  a scratch careerforge_e2e DB created at API boot, dropped at teardown.

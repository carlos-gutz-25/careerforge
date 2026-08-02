#!/bin/sh
# M10-02 container entrypoint: migrate-then-boot. Runs as PID 1 so the API
# process receives container signals directly (exec, no shell wrapper).
set -eu

# Forward-only, idempotent migrations before the server accepts traffic.
# Reads DATABASE_URL from the environment; a migration failure aborts boot.
node packages/db/src/cli/migrate.ts

# Hand off PID 1 to the API server.
exec node apps/api/src/main.ts

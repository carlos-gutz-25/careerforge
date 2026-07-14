import { defineConfig } from 'drizzle-kit';

// Credential-free on purpose: `drizzle-kit generate` diffs the TS schema
// against the checked-in migration journal, no DB connection involved.
// Applying migrations is src/migrate.ts (pnpm db:migrate), which reads
// DATABASE_URL from the environment.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
});

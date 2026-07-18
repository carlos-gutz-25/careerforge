-- M1-08: remove legacy placeholder criteria rows. Pre-canonical rows are the
-- only ones whose positive_signals is a JSON ARRAY (the canonical shape is an
-- object of signal categories) — a clean discriminator. Approved 2026-07-17
-- with evidence: a local SELECT returned exactly one matching row (the seed
-- user's fictional placeholder, re-creatable via pnpm db:seed). Forward-only.
DELETE FROM "search_criteria" WHERE jsonb_typeof("positive_signals") = 'array';--> statement-breakpoint
ALTER TABLE "search_criteria" ALTER COLUMN "positive_signals" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "search_criteria" ADD COLUMN "force_lowest_priority" jsonb DEFAULT '{}'::jsonb NOT NULL;
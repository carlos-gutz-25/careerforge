ALTER TABLE "resume_compose_runs" ADD COLUMN "gate_violations" jsonb;--> statement-breakpoint
ALTER TABLE "resume_compose_runs" ADD CONSTRAINT "resume_compose_runs_gate_violations_check" CHECK (
    CASE
      WHEN "resume_compose_runs"."gate_violations" IS NULL THEN "resume_compose_runs"."status" <> 'flagged'
      WHEN jsonb_typeof("resume_compose_runs"."gate_violations") <> 'array' THEN false
      ELSE (jsonb_array_length("resume_compose_runs"."gate_violations") > 0) = ("resume_compose_runs"."status" = 'flagged')
    END) NOT VALID;
--> statement-breakpoint
-- HAND-EDITED (M15-01): drizzle-kit does not emit NOT VALID, so the modifier
-- above was added by hand. Precedent: migration 0014, the repo's first
-- hand-edited SQL. NOT VALID is LOAD-BEARING and must not be dropped: it
-- enforces the CHECK on every INSERT and UPDATE while skipping the validation
-- scan of pre-existing rows. Rows written before this migration - including the
-- incident run that motivated the story - are `flagged` with a NULL payload,
-- which branch 1 forbids, so a VALIDATED constraint would make `pnpm db:migrate`
-- fail on an existing database. Grandfathering those rows is deliberate: the
-- honest value for them is NULL, since the gate's reasons were never recorded.
-- Park: VALIDATE CONSTRAINT once those rows have aged out.
ALTER TABLE "resume_compose_runs" DROP CONSTRAINT "resume_compose_runs_status_check";--> statement-breakpoint
ALTER TABLE "resume_compose_runs" DROP CONSTRAINT "resume_compose_runs_gate_violations_check";--> statement-breakpoint
ALTER TABLE "resume_documents" ADD COLUMN "degrade_disclosure" jsonb;--> statement-breakpoint
ALTER TABLE "resume_compose_runs" ADD CONSTRAINT "resume_compose_runs_status_check" CHECK ("resume_compose_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged', 'empty', 'degraded'));--> statement-breakpoint
ALTER TABLE "resume_compose_runs" ADD CONSTRAINT "resume_compose_runs_gate_violations_check" CHECK (
    CASE
      WHEN "resume_compose_runs"."gate_violations" IS NULL THEN "resume_compose_runs"."status" NOT IN ('flagged', 'degraded')
      WHEN jsonb_typeof("resume_compose_runs"."gate_violations") <> 'array' THEN false
      ELSE (jsonb_array_length("resume_compose_runs"."gate_violations") > 0) = ("resume_compose_runs"."status" IN ('flagged', 'degraded'))
    END) NOT VALID;--> statement-breakpoint
-- HAND-EDITED (M15-03): drizzle-kit does not emit NOT VALID, so the modifier
-- above was added by hand. Precedent: 0026, which carries the same modifier on
-- the same constraint, and 0014, the repo's first hand-edited SQL. NOT VALID is
-- LOAD-BEARING and must not be dropped.
--
-- Why it is required HERE, where the widening looks harmless. Re-adding a
-- constraint makes Postgres SCAN the table. The two arms above are strictly
-- compatible with every row that satisfied 0026's version, so the new predicate
-- is not the hazard -- the GRANDFATHERED PRE-0026 ROWS are: 0026 deliberately
-- did not validate them, so rows that never satisfied this predicate may still
-- exist. A plain ADD CONSTRAINT would scan those and fail the migration. NOT
-- VALID keeps exactly 0026's grandfathering: enforced on every INSERT and
-- UPDATE, no scan. ADR-0018's parked VALIDATE CONSTRAINT stays parked and is
-- NOT discharged here.
--
-- The status_check above is re-added PLAIN, and that asymmetry is deliberate,
-- not an oversight: it was convalidated=true in the live DB (verified before
-- this migration was written), and widening an enumerated list cannot invalidate
-- a row that already conformed to the narrower one, so its scan is safe.
ALTER TABLE "exercises" ADD COLUMN "completed_on" date;--> statement-breakpoint
-- HAND-EDITED (M3-05, the repo's first): backfill legacy complete rows BEFORE
-- the constraint below, or it would reject them. updated_at is the last
-- status-PATCH instant, so it is a never-LATE bound on the true completion
-- date; ::date truncates in the DB session timezone, so a backfilled revisit
-- can surface at most ~1 day EARLY — benign for spaced review.
UPDATE "exercises" SET "completed_on" = "updated_at"::date WHERE "status" = 'complete';--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_completed_on_check" CHECK (("exercises"."status" = 'complete') = ("exercises"."completed_on" is not null));

CREATE TABLE "mastery_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"artifact_url" text,
	"recorded_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_evidence_kind_check" CHECK ("mastery_evidence"."kind" in ('implemented', 'tested', 'explained', 'revisited'))
);
--> statement-breakpoint
ALTER TABLE "mastery_evidence" ADD CONSTRAINT "mastery_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_evidence" ADD CONSTRAINT "mastery_evidence_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;
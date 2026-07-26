CREATE TABLE "case_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid,
	"exercise_title" text NOT NULL,
	"title" text NOT NULL,
	"provenance" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rendered_markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_studies_provenance_check" CHECK ("case_studies"."provenance" in ('professional', 'personal', 'personal_ai_assisted')),
	CONSTRAINT "case_studies_status_check" CHECK ("case_studies"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_studies_exercise_unique" ON "case_studies" USING btree ("exercise_id");
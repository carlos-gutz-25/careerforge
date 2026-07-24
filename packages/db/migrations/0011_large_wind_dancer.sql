CREATE TABLE "exercise_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"gap_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_plan_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_kind_check" CHECK ("exercises"."kind" in ('kata', 'project', 'writeup', 'interview_drill')),
	CONSTRAINT "exercises_status_check" CHECK ("exercises"."status" in ('planned', 'in_progress', 'complete'))
);
--> statement-breakpoint
ALTER TABLE "exercise_gaps" ADD CONSTRAINT "exercise_gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_gaps" ADD CONSTRAINT "exercise_gaps_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_gaps" ADD CONSTRAINT "exercise_gaps_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_learning_plan_id_learning_plans_id_fk" FOREIGN KEY ("learning_plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_gaps_exercise_gap_unique" ON "exercise_gaps" USING btree ("exercise_id","gap_id");
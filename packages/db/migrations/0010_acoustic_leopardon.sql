CREATE TABLE "learning_plan_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_plan_id" uuid NOT NULL,
	"gap_id" uuid NOT NULL,
	"focus" text NOT NULL,
	"priority" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_plan_gaps_priority_check" CHECK ("learning_plan_gaps"."priority" in ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "learning_plan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_id" text NOT NULL,
	"raw_response" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_input_tokens" integer NOT NULL,
	"cache_creation_input_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_plan_runs_status_check" CHECK ("learning_plan_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "learning_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"drafting_run_id" uuid NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_plans_review_status_check" CHECK ("learning_plans"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "learning_plan_gaps" ADD CONSTRAINT "learning_plan_gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan_gaps" ADD CONSTRAINT "learning_plan_gaps_learning_plan_id_learning_plans_id_fk" FOREIGN KEY ("learning_plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan_gaps" ADD CONSTRAINT "learning_plan_gaps_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan_runs" ADD CONSTRAINT "learning_plan_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_drafting_run_id_learning_plan_runs_id_fk" FOREIGN KEY ("drafting_run_id") REFERENCES "public"."learning_plan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_plan_gaps_plan_gap_unique" ON "learning_plan_gaps" USING btree ("learning_plan_id","gap_id");
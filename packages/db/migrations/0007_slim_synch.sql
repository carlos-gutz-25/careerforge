CREATE TABLE "improvement_plan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
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
	CONSTRAINT "improvement_plan_runs_status_check" CHECK ("improvement_plan_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "improvement_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"drafting_run_id" uuid NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "improvement_plans_review_status_check" CHECK ("improvement_plans"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"improvement_plan_id" uuid NOT NULL,
	"gap_id" uuid NOT NULL,
	"action" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_priority_check" CHECK ("plan_items"."priority" in ('high', 'medium', 'low')),
	CONSTRAINT "plan_items_status_check" CHECK ("plan_items"."status" in ('planned', 'in_progress', 'complete', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "improvement_plan_runs" ADD CONSTRAINT "improvement_plan_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plan_runs" ADD CONSTRAINT "improvement_plan_runs_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_drafting_run_id_improvement_plan_runs_id_fk" FOREIGN KEY ("drafting_run_id") REFERENCES "public"."improvement_plan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_improvement_plan_id_improvement_plans_id_fk" FOREIGN KEY ("improvement_plan_id") REFERENCES "public"."improvement_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "improvement_plans_fit_report_id_unique" ON "improvement_plans" USING btree ("fit_report_id");
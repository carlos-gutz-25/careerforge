CREATE TABLE "application_gameplan_runs" (
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
	CONSTRAINT "application_gameplan_runs_status_check" CHECK ("application_gameplan_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "application_gameplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"drafting_run_id" uuid NOT NULL,
	"strategy_summary" text NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_gameplans_review_status_check" CHECK ("application_gameplans"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
CREATE TABLE "gameplan_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_gameplan_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameplan_checks_check_key_check" CHECK ("gameplan_checks"."check_key" in ('apply-tailor-resume', 'apply-reread-posting', 'apply-submit', 'screen-recruiter-prep', 'screen-logistics', 'interview-star-rehearse', 'interview-company-research', 'interview-questions-to-ask', 'offer-compensation-research', 'offer-references', 'offer-decision-criteria'))
);
--> statement-breakpoint
CREATE TABLE "gameplan_phase_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_gameplan_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"strategy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameplan_phase_strategies_phase_check" CHECK ("gameplan_phase_strategies"."phase" in ('apply', 'screen', 'interview', 'offer'))
);
--> statement-breakpoint
CREATE TABLE "gameplan_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_gameplan_id" uuid NOT NULL,
	"situation" text NOT NULL,
	"task" text NOT NULL,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gameplan_story_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gameplan_story_id" uuid NOT NULL,
	"evidence_link_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_gameplan_runs" ADD CONSTRAINT "application_gameplan_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_gameplan_runs" ADD CONSTRAINT "application_gameplan_runs_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_gameplans" ADD CONSTRAINT "application_gameplans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_gameplans" ADD CONSTRAINT "application_gameplans_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_gameplans" ADD CONSTRAINT "application_gameplans_drafting_run_id_application_gameplan_runs_id_fk" FOREIGN KEY ("drafting_run_id") REFERENCES "public"."application_gameplan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_checks" ADD CONSTRAINT "gameplan_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_checks" ADD CONSTRAINT "gameplan_checks_application_gameplan_id_application_gameplans_id_fk" FOREIGN KEY ("application_gameplan_id") REFERENCES "public"."application_gameplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_phase_strategies" ADD CONSTRAINT "gameplan_phase_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_phase_strategies" ADD CONSTRAINT "gameplan_phase_strategies_application_gameplan_id_application_gameplans_id_fk" FOREIGN KEY ("application_gameplan_id") REFERENCES "public"."application_gameplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_stories" ADD CONSTRAINT "gameplan_stories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_stories" ADD CONSTRAINT "gameplan_stories_application_gameplan_id_application_gameplans_id_fk" FOREIGN KEY ("application_gameplan_id") REFERENCES "public"."application_gameplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_story_citations" ADD CONSTRAINT "gameplan_story_citations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_story_citations" ADD CONSTRAINT "gameplan_story_citations_gameplan_story_id_gameplan_stories_id_fk" FOREIGN KEY ("gameplan_story_id") REFERENCES "public"."gameplan_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplan_story_citations" ADD CONSTRAINT "gameplan_story_citations_evidence_link_id_evidence_links_id_fk" FOREIGN KEY ("evidence_link_id") REFERENCES "public"."evidence_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_gameplans_fit_report_id_unique" ON "application_gameplans" USING btree ("fit_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gameplan_checks_gameplan_key_unique" ON "gameplan_checks" USING btree ("application_gameplan_id","check_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gameplan_phase_strategies_gameplan_phase_unique" ON "gameplan_phase_strategies" USING btree ("application_gameplan_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "gameplan_stories_gameplan_position_unique" ON "gameplan_stories" USING btree ("application_gameplan_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "gameplan_story_citations_story_position_unique" ON "gameplan_story_citations" USING btree ("gameplan_story_id","position");
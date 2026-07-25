CREATE TABLE "interview_prep_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"interview_prep_question_id" uuid NOT NULL,
	"type" text NOT NULL,
	"evidence_link_id" uuid,
	"gap_id" uuid,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_prep_points_type_check" CHECK ("interview_prep_points"."type" in ('evidence', 'gap_disclosure')),
	CONSTRAINT "interview_prep_points_type_fk_check" CHECK (("interview_prep_points"."type" <> 'evidence' or ("interview_prep_points"."evidence_link_id" is not null and "interview_prep_points"."gap_id" is null))
        and ("interview_prep_points"."type" <> 'gap_disclosure' or ("interview_prep_points"."gap_id" is not null and "interview_prep_points"."evidence_link_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "interview_prep_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"interview_prep_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_prep_questions_kind_check" CHECK ("interview_prep_questions"."kind" in ('technical', 'behavioral'))
);
--> statement-breakpoint
CREATE TABLE "interview_prep_runs" (
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
	CONSTRAINT "interview_prep_runs_status_check" CHECK ("interview_prep_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "interview_preps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"drafting_run_id" uuid NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_preps_review_status_check" CHECK ("interview_preps"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "interview_prep_points" ADD CONSTRAINT "interview_prep_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_points" ADD CONSTRAINT "interview_prep_points_interview_prep_question_id_interview_prep_questions_id_fk" FOREIGN KEY ("interview_prep_question_id") REFERENCES "public"."interview_prep_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_points" ADD CONSTRAINT "interview_prep_points_evidence_link_id_evidence_links_id_fk" FOREIGN KEY ("evidence_link_id") REFERENCES "public"."evidence_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_points" ADD CONSTRAINT "interview_prep_points_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_questions" ADD CONSTRAINT "interview_prep_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_questions" ADD CONSTRAINT "interview_prep_questions_interview_prep_id_interview_preps_id_fk" FOREIGN KEY ("interview_prep_id") REFERENCES "public"."interview_preps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_questions" ADD CONSTRAINT "interview_prep_questions_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_runs" ADD CONSTRAINT "interview_prep_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_runs" ADD CONSTRAINT "interview_prep_runs_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_preps" ADD CONSTRAINT "interview_preps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_preps" ADD CONSTRAINT "interview_preps_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_preps" ADD CONSTRAINT "interview_preps_drafting_run_id_interview_prep_runs_id_fk" FOREIGN KEY ("drafting_run_id") REFERENCES "public"."interview_prep_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_preps_fit_report_id_unique" ON "interview_preps" USING btree ("fit_report_id");
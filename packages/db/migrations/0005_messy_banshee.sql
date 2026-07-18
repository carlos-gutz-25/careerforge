CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_sub_score_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"profile_skill_id" uuid,
	"profile_project_id" uuid,
	"profile_experience_id" uuid,
	"posting_quote" text NOT NULL,
	"profile_quote" text NOT NULL,
	"strength" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_links_strength_check" CHECK ("evidence_links"."strength" in ('direct', 'partial', 'adjacent'))
);
--> statement-breakpoint
CREATE TABLE "fit_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"posting_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"exclusions" jsonb NOT NULL,
	"criteria_snapshot" jsonb NOT NULL,
	"forced_lowest" jsonb NOT NULL,
	"input_flagged" boolean NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fit_reports_verdict_check" CHECK ("fit_reports"."verdict" in ('scored', 'excluded')),
	CONSTRAINT "fit_reports_review_status_check" CHECK ("fit_reports"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
CREATE TABLE "fit_sub_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" real NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fit_sub_scores_dimension_check" CHECK ("fit_sub_scores"."dimension" in ('min_quals', 'technical', 'domain', 'seniority', 'comp_location', 'priority', 'stretch')),
	CONSTRAINT "fit_sub_scores_score_range_check" CHECK ("fit_sub_scores"."score" >= 0 and "fit_sub_scores"."score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_fit_sub_score_id_fit_sub_scores_id_fk" FOREIGN KEY ("fit_sub_score_id") REFERENCES "public"."fit_sub_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_profile_skill_id_profile_skills_id_fk" FOREIGN KEY ("profile_skill_id") REFERENCES "public"."profile_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_profile_project_id_profile_projects_id_fk" FOREIGN KEY ("profile_project_id") REFERENCES "public"."profile_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_profile_experience_id_profile_experiences_id_fk" FOREIGN KEY ("profile_experience_id") REFERENCES "public"."profile_experiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_reports" ADD CONSTRAINT "fit_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_reports" ADD CONSTRAINT "fit_reports_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_reports" ADD CONSTRAINT "fit_reports_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_sub_scores" ADD CONSTRAINT "fit_sub_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_sub_scores" ADD CONSTRAINT "fit_sub_scores_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fit_sub_scores_report_dimension_unique" ON "fit_sub_scores" USING btree ("fit_report_id","dimension");
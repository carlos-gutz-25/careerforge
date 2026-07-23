CREATE TABLE "resume_variant_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_variant_entry_id" uuid NOT NULL,
	"gap_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_variant_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_variant_id" uuid NOT NULL,
	"section" text NOT NULL,
	"position" integer NOT NULL,
	"profile_skill_id" uuid,
	"profile_project_id" uuid,
	"profile_experience_id" uuid,
	"label" text NOT NULL,
	"detail" text,
	"emphasis" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_variant_entries_section_check" CHECK ("resume_variant_entries"."section" in ('skill', 'experience', 'project')),
	CONSTRAINT "resume_variant_entries_emphasis_check" CHECK ("resume_variant_entries"."emphasis" in ('lead', 'highlight')),
	CONSTRAINT "resume_variant_entries_emphasis_reason_check" CHECK (("resume_variant_entries"."emphasis" is null) = ("resume_variant_entries"."reason" is null)),
	CONSTRAINT "resume_variant_entries_section_fk_check" CHECK (("resume_variant_entries"."section" <> 'skill' or ("resume_variant_entries"."profile_project_id" is null and "resume_variant_entries"."profile_experience_id" is null))
        and ("resume_variant_entries"."section" <> 'experience' or ("resume_variant_entries"."profile_skill_id" is null and "resume_variant_entries"."profile_project_id" is null))
        and ("resume_variant_entries"."section" <> 'project' or ("resume_variant_entries"."profile_skill_id" is null and "resume_variant_entries"."profile_experience_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "resume_variant_runs" (
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
	CONSTRAINT "resume_variant_runs_status_check" CHECK ("resume_variant_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "resume_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"tailoring_run_id" uuid NOT NULL,
	"rendered_markdown" text NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_variants_review_status_check" CHECK ("resume_variants"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "resume_variant_citations" ADD CONSTRAINT "resume_variant_citations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_citations" ADD CONSTRAINT "resume_variant_citations_resume_variant_entry_id_resume_variant_entries_id_fk" FOREIGN KEY ("resume_variant_entry_id") REFERENCES "public"."resume_variant_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_citations" ADD CONSTRAINT "resume_variant_citations_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_entries" ADD CONSTRAINT "resume_variant_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_entries" ADD CONSTRAINT "resume_variant_entries_resume_variant_id_resume_variants_id_fk" FOREIGN KEY ("resume_variant_id") REFERENCES "public"."resume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_entries" ADD CONSTRAINT "resume_variant_entries_profile_skill_id_profile_skills_id_fk" FOREIGN KEY ("profile_skill_id") REFERENCES "public"."profile_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_entries" ADD CONSTRAINT "resume_variant_entries_profile_project_id_profile_projects_id_fk" FOREIGN KEY ("profile_project_id") REFERENCES "public"."profile_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_entries" ADD CONSTRAINT "resume_variant_entries_profile_experience_id_profile_experiences_id_fk" FOREIGN KEY ("profile_experience_id") REFERENCES "public"."profile_experiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_runs" ADD CONSTRAINT "resume_variant_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variant_runs" ADD CONSTRAINT "resume_variant_runs_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variants" ADD CONSTRAINT "resume_variants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variants" ADD CONSTRAINT "resume_variants_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_variants" ADD CONSTRAINT "resume_variants_tailoring_run_id_resume_variant_runs_id_fk" FOREIGN KEY ("tailoring_run_id") REFERENCES "public"."resume_variant_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_variant_citations_entry_gap_unique" ON "resume_variant_citations" USING btree ("resume_variant_entry_id","gap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_variant_entries_variant_section_position_unique" ON "resume_variant_entries" USING btree ("resume_variant_id","section","position");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_variants_fit_report_id_unique" ON "resume_variants" USING btree ("fit_report_id");
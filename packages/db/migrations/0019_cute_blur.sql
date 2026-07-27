CREATE TABLE "resume_claim_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_claim_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_text" text NOT NULL,
	"experience_bullet_id" uuid,
	"mastery_evidence_id" uuid,
	"project_id" uuid,
	"summary_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_claim_citations_source_kind_check" CHECK ("resume_claim_citations"."source_kind" in ('experience_bullet', 'mastery_evidence', 'project', 'summary')),
	CONSTRAINT "resume_claim_citations_source_atmost1_check" CHECK ((case when "resume_claim_citations"."experience_bullet_id" is not null then 1 else 0 end
        + case when "resume_claim_citations"."mastery_evidence_id" is not null then 1 else 0 end
        + case when "resume_claim_citations"."project_id" is not null then 1 else 0 end
        + case when "resume_claim_citations"."summary_id" is not null then 1 else 0 end) <= 1)
);
--> statement-breakpoint
CREATE TABLE "resume_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_document_id" uuid NOT NULL,
	"section" text NOT NULL,
	"experience_id" uuid,
	"project_id" uuid,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_claims_section_check" CHECK ("resume_claims"."section" in ('summary', 'experience', 'project')),
	CONSTRAINT "resume_claims_section_entity_check" CHECK (("resume_claims"."section" <> 'experience' or "resume_claims"."project_id" is null)
        and ("resume_claims"."section" <> 'project' or "resume_claims"."experience_id" is null)
        and ("resume_claims"."section" <> 'summary' or ("resume_claims"."experience_id" is null and "resume_claims"."project_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "resume_compose_runs" (
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
	CONSTRAINT "resume_compose_runs_status_check" CHECK ("resume_compose_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged', 'empty'))
);
--> statement-breakpoint
CREATE TABLE "resume_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"compose_run_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"canonical_doc" jsonb NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"superseded_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_documents_review_status_check" CHECK ("resume_documents"."review_status" in ('draft', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_resume_claim_id_resume_claims_id_fk" FOREIGN KEY ("resume_claim_id") REFERENCES "public"."resume_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_experience_bullet_id_profile_experience_bullets_id_fk" FOREIGN KEY ("experience_bullet_id") REFERENCES "public"."profile_experience_bullets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_mastery_evidence_id_mastery_evidence_id_fk" FOREIGN KEY ("mastery_evidence_id") REFERENCES "public"."mastery_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_project_id_profile_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."profile_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claim_citations" ADD CONSTRAINT "resume_claim_citations_summary_id_profile_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."profile_summaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claims" ADD CONSTRAINT "resume_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claims" ADD CONSTRAINT "resume_claims_resume_document_id_resume_documents_id_fk" FOREIGN KEY ("resume_document_id") REFERENCES "public"."resume_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claims" ADD CONSTRAINT "resume_claims_experience_id_profile_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."profile_experiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_claims" ADD CONSTRAINT "resume_claims_project_id_profile_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."profile_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_compose_runs" ADD CONSTRAINT "resume_compose_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_compose_runs" ADD CONSTRAINT "resume_compose_runs_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_compose_run_id_resume_compose_runs_id_fk" FOREIGN KEY ("compose_run_id") REFERENCES "public"."resume_compose_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_claim_citations_claim_position_unique" ON "resume_claim_citations" USING btree ("resume_claim_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_claims_document_position_unique" ON "resume_claims" USING btree ("resume_document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_documents_report_revision_unique" ON "resume_documents" USING btree ("fit_report_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_documents_current_unique" ON "resume_documents" USING btree ("fit_report_id") WHERE "resume_documents"."superseded_at" is null;
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"posting_id" uuid NOT NULL,
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
	CONSTRAINT "extraction_runs_status_check" CHECK ("extraction_runs"."status" in ('ok', 'schema_failed', 'refusal', 'max_tokens', 'error', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"source_quote" text NOT NULL,
	"quote_verified" boolean,
	"confidence" real NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_kind_check" CHECK ("requirements"."kind" in ('must_have', 'nice_to_have')),
	CONSTRAINT "requirements_category_check" CHECK ("requirements"."category" in ('language', 'framework', 'domain', 'seniority', 'comp', 'location', 'other'))
);
--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;
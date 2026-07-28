CREATE TABLE "demo_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gap_id" uuid,
	"group_key" text NOT NULL,
	"group_key_hash" text GENERATED ALWAYS AS (md5(group_key)) STORED NOT NULL,
	"requirement_text" text NOT NULL,
	"title" text NOT NULL,
	"scorer_version" integer NOT NULL,
	"posting_count" integer NOT NULL,
	"instance_count" integer NOT NULL,
	"must_have_posting_count" integer NOT NULL,
	"nice_to_have_posting_count" integer NOT NULL,
	"categories" jsonb NOT NULL,
	"refs" jsonb NOT NULL,
	"problem" text NOT NULL,
	"constraints" text NOT NULL,
	"deliverables" text NOT NULL,
	"evidence_required" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_blueprints_posting_count_check" CHECK ("demo_blueprints"."posting_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "demo_blueprints" ADD CONSTRAINT "demo_blueprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_blueprints" ADD CONSTRAINT "demo_blueprints_gap_id_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_blueprints_user_group_unique" ON "demo_blueprints" USING btree ("user_id","group_key_hash");
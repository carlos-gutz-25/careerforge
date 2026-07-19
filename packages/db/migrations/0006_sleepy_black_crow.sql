CREATE TABLE "gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_report_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"engine_classification" text NOT NULL,
	"rationale" text NOT NULL,
	"user_overridden" boolean DEFAULT false NOT NULL,
	"override_note" text,
	"carried_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gaps_classification_check" CHECK ("gaps"."classification" in ('have', 'have_undemonstrated', 'needs_refresh', 'genuine_gap', 'low_priority')),
	CONSTRAINT "gaps_engine_classification_check" CHECK ("gaps"."engine_classification" in ('have', 'have_undemonstrated', 'needs_refresh', 'genuine_gap', 'low_priority')),
	CONSTRAINT "gaps_carried_via_check" CHECK ("gaps"."carried_via" in ('requirement_id', 'content'))
);
--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_fit_report_id_fit_reports_id_fk" FOREIGN KEY ("fit_report_id") REFERENCES "public"."fit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gaps_report_requirement_unique" ON "gaps" USING btree ("fit_report_id","requirement_id");
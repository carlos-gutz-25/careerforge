CREATE TABLE "criteria_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"slug" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"criteria_before" jsonb NOT NULL,
	"criteria_after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criteria_adjustments_kind_check" CHECK ("criteria_adjustments"."kind" in ('remove_positive_signal', 'remove_negative_signal')),
	CONSTRAINT "criteria_adjustments_category_check" CHECK ("criteria_adjustments"."category" in ('role', 'technologies', 'problem_domains', 'work_arrangement', 'scope')),
	CONSTRAINT "criteria_adjustments_category_kind_check" CHECK (("criteria_adjustments"."kind" = 'remove_positive_signal') = ("criteria_adjustments"."category" is not null))
);
--> statement-breakpoint
ALTER TABLE "criteria_adjustments" ADD CONSTRAINT "criteria_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
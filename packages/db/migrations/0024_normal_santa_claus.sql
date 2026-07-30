CREATE TABLE "profile_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"declared_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_facts_kind_check" CHECK ("profile_facts"."kind" in ('work_authorization', 'visa_sponsorship_needed', 'relocation_stance', 'remote_onsite_stance', 'security_clearance', 'availability_notice')),
	CONSTRAINT "profile_facts_value_vocab_check" CHECK (("profile_facts"."kind" <> 'visa_sponsorship_needed' or "profile_facts"."value" in ('yes', 'no'))
        and ("profile_facts"."kind" <> 'relocation_stance' or "profile_facts"."value" in ('willing', 'open_for_right_opportunity', 'prefer_not', 'no'))
        and ("profile_facts"."kind" <> 'remote_onsite_stance' or "profile_facts"."value" in ('remote_only', 'prefer_remote', 'flexible', 'prefer_onsite', 'onsite_ok')))
);
--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_facts_user_kind_unique" ON "profile_facts" USING btree ("user_id","kind");
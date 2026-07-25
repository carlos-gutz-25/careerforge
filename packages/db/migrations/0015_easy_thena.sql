CREATE TABLE "skill_upgrade_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_upgrade_id" uuid NOT NULL,
	"mastery_evidence_id" uuid,
	"kind" text NOT NULL,
	"artifact_url" text,
	"recorded_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_upgrade_evidence_kind_check" CHECK ("skill_upgrade_evidence"."kind" in ('implemented', 'tested', 'explained', 'revisited'))
);
--> statement-breakpoint
CREATE TABLE "skill_upgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_skill_id" uuid,
	"skill_name" text NOT NULL,
	"skill_name_key" text NOT NULL,
	"from_level" text NOT NULL,
	"to_level" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_note" text,
	"exercise_id" uuid,
	"exercise_title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_upgrades_from_level_check" CHECK ("skill_upgrades"."from_level" in ('expert', 'solid', 'rusty', 'learning')),
	CONSTRAINT "skill_upgrades_to_level_check" CHECK ("skill_upgrades"."to_level" in ('expert', 'solid', 'rusty', 'learning')),
	CONSTRAINT "skill_upgrades_status_check" CHECK ("skill_upgrades"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "skill_upgrade_evidence" ADD CONSTRAINT "skill_upgrade_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_upgrade_evidence" ADD CONSTRAINT "skill_upgrade_evidence_skill_upgrade_id_skill_upgrades_id_fk" FOREIGN KEY ("skill_upgrade_id") REFERENCES "public"."skill_upgrades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_upgrade_evidence" ADD CONSTRAINT "skill_upgrade_evidence_mastery_evidence_id_mastery_evidence_id_fk" FOREIGN KEY ("mastery_evidence_id") REFERENCES "public"."mastery_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_upgrades" ADD CONSTRAINT "skill_upgrades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_upgrades" ADD CONSTRAINT "skill_upgrades_profile_skill_id_profile_skills_id_fk" FOREIGN KEY ("profile_skill_id") REFERENCES "public"."profile_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_upgrades" ADD CONSTRAINT "skill_upgrades_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_upgrades_user_key_active_unique" ON "skill_upgrades" USING btree ("user_id","skill_name_key") WHERE status = 'active';
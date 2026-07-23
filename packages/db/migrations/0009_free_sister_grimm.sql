CREATE TABLE "profile_experience_bullets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"experience_id" uuid NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_experience_bullets" ADD CONSTRAINT "profile_experience_bullets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_experience_bullets" ADD CONSTRAINT "profile_experience_bullets_experience_id_profile_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."profile_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_experience_bullets_experience_position_unique" ON "profile_experience_bullets" USING btree ("experience_id","position");
CREATE TABLE "plan_item_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"expected_benefit" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_item_recommendations_kind_check" CHECK ("plan_item_recommendations"."kind" in ('resource', 'certification', 'demo_project', 'practice')),
	CONSTRAINT "plan_item_recommendations_status_check" CHECK ("plan_item_recommendations"."status" in ('suggested', 'adopted', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "plan_item_recommendations" ADD CONSTRAINT "plan_item_recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_item_recommendations" ADD CONSTRAINT "plan_item_recommendations_plan_item_id_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."plan_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_item_recommendations_item_position_unique" ON "plan_item_recommendations" USING btree ("plan_item_id","position");
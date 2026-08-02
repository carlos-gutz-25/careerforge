CREATE TABLE "demo_seed_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fixture_set_version" text NOT NULL,
	"fixture_manifest_sha256" text NOT NULL,
	CONSTRAINT "demo_seed_state_singleton_check" CHECK ("demo_seed_state"."id" = 1)
);

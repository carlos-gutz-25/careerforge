ALTER TABLE "gaps" DROP CONSTRAINT "gaps_classification_check";--> statement-breakpoint
ALTER TABLE "gaps" DROP CONSTRAINT "gaps_engine_classification_check";--> statement-breakpoint
ALTER TABLE "gaps" ADD COLUMN "evaluator" text;--> statement-breakpoint
ALTER TABLE "gaps" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_evaluator_check" CHECK ("gaps"."evaluator" in ('skill_evidence', 'seniority_threshold', 'dimension_delegation', 'administrative_pattern', 'durable_profile_fact', 'manual_review'));--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_confidence_check" CHECK ("gaps"."confidence" in ('high', 'medium', 'low'));--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_classification_check" CHECK ("gaps"."classification" in ('have', 'have_undemonstrated', 'needs_refresh', 'genuine_gap', 'low_priority', 'unknown', 'satisfied_fact', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_engine_classification_check" CHECK ("gaps"."engine_classification" in ('have', 'have_undemonstrated', 'needs_refresh', 'genuine_gap', 'low_priority', 'unknown', 'satisfied_fact', 'not_applicable'));
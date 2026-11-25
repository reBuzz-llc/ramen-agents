ALTER TABLE "sample_versions" ADD COLUMN "not_complete" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "not_complete" text DEFAULT '' NOT NULL;
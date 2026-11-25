ALTER TABLE "sample_versions" ADD COLUMN "pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "pages" jsonb DEFAULT '[]'::jsonb NOT NULL;
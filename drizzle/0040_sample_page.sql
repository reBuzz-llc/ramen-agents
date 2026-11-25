ALTER TABLE "leads" ADD COLUMN "site_facts" jsonb;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "kind" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "changes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "signature" jsonb;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "design_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "kind" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "changes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "signature" jsonb;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "design_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "assets" jsonb DEFAULT '[]'::jsonb NOT NULL;
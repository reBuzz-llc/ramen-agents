ALTER TABLE "asset_packages" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "review_verdict" text;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "review_note" text;
ALTER TABLE "asset_packages" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "why" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "handed_over_by" text;--> statement-breakpoint
ALTER TABLE "asset_packages" ADD COLUMN "handed_over_at" timestamp with time zone;
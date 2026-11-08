ALTER TABLE "leads" ADD COLUMN "draft_followup" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_at" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_by" text[];
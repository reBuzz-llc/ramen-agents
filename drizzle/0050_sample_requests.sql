CREATE TABLE "sample_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_id" uuid NOT NULL,
	"text" text NOT NULL,
	"pictures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"by_user" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"made_on_version" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answered_version" integer,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sample_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD COLUMN "assets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "approved_version" integer;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sample_requests_sample" ON "sample_requests" USING btree ("sample_id","at");--> statement-breakpoint
-- 664 backfill: a sample that is approved or live now has its current version approved; a draft or sent-back one (Ssam Tong's v18) stays null
UPDATE "samples" SET "approved_version" = "version" WHERE "status" IN ('approved', 'live');

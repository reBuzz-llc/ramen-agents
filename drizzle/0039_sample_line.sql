CREATE TABLE "sample_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"copy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"facts_hash" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"made_by" text DEFAULT '' NOT NULL,
	"made_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "facts_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "copy_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "changes_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD CONSTRAINT "sample_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_versions" ADD CONSTRAINT "sample_versions_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sample_versions_sample" ON "sample_versions" USING btree ("sample_id","version");
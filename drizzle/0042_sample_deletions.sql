CREATE TABLE "sample_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"sample_id" uuid NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"business" text DEFAULT '' NOT NULL,
	"versions" integer DEFAULT 0 NOT NULL,
	"deleted_by" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" text,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sample_deletions" ADD CONSTRAINT "sample_deletions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_deletions" ADD CONSTRAINT "sample_deletions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sample_deletions_lead" ON "sample_deletions" USING btree ("tenant_id","lead_id");
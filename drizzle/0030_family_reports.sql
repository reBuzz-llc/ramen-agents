CREATE TABLE "family_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"lines" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posted_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_reports" ADD CONSTRAINT "family_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_reports_latest" ON "family_reports" USING btree ("tenant_id","kind","at");
CREATE TABLE "asset_package_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"by" text DEFAULT '' NOT NULL,
	"via" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"tenant_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "asset_package_changes" ADD CONSTRAINT "asset_package_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_package_changes_package" ON "asset_package_changes" USING btree ("tenant_id","package_id","id");--> statement-breakpoint
CREATE INDEX "job_runs_job" ON "job_runs" USING btree ("job","tenant_id","at");
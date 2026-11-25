CREATE TABLE "template_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group" text NOT NULL,
	"channel" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"lead_name" text DEFAULT '' NOT NULL,
	"edit_id" bigint NOT NULL,
	"edited_by" text DEFAULT '' NOT NULL,
	"edited_at" timestamp with time zone NOT NULL,
	"before" text DEFAULT '' NOT NULL,
	"after" text DEFAULT '' NOT NULL,
	"template" text DEFAULT '' NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"text_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_where" text,
	"decided_at" timestamp with time zone,
	"opened_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_proposals_edit" ON "template_proposals" USING btree ("tenant_id","lead_id","channel","edit_id");--> statement-breakpoint
CREATE INDEX "template_proposals_status" ON "template_proposals" USING btree ("tenant_id","status","updated_at");
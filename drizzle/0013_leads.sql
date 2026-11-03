CREATE SEQUENCE "public"."leads_rev_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "lead_cells" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"column" text NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"actor_kind" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_user_id" uuid,
	"via" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"outcome" text DEFAULT 'applied' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notion_page_id" text,
	"notion_url" text,
	"notion_uid" text,
	"business" text NOT NULL,
	"website" text,
	"domain" text,
	"business_email" text,
	"email_check" text,
	"location" text,
	"city" text,
	"state" text,
	"industry" text,
	"size" text,
	"contact_person" text,
	"contact_role" text,
	"founder_linkedin" text,
	"linkedin_via" text,
	"whatsapp" text,
	"map_link" text,
	"pain_point" text,
	"package" text,
	"evidence" text,
	"source_pages" text,
	"tools_on_site" text[],
	"site_health" text,
	"lead_score" double precision,
	"draft_email" text,
	"draft_whatsapp" text,
	"email_status" text,
	"whatsapp_status" text,
	"result" text,
	"result_date" date,
	"sent_by" text[],
	"sent_at" timestamp with time zone,
	"found_by" text,
	"archived" boolean DEFAULT false NOT NULL,
	"last_actor_name" text,
	"last_actor_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rev" bigint DEFAULT nextval('leads_rev_seq') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_cells" ADD CONSTRAINT "lead_cells_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_cells" ADD CONSTRAINT "lead_cells_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_cells" ADD CONSTRAINT "lead_cells_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_cells_lead" ON "lead_cells" USING btree ("lead_id","column","id");--> statement-breakpoint
CREATE INDEX "lead_cells_tenant" ON "lead_cells" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_notion_page" ON "leads" USING btree ("tenant_id","notion_page_id");--> statement-breakpoint
CREATE INDEX "leads_status" ON "leads" USING btree ("tenant_id","email_status","whatsapp_status");--> statement-breakpoint
CREATE INDEX "leads_domain" ON "leads" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE INDEX "leads_updated" ON "leads" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "leads_rev" ON "leads" USING btree ("tenant_id","rev");
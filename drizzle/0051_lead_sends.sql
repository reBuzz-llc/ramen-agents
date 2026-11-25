CREATE TABLE "lead_sample_tests" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_sample_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lead_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"variant" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"replied_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"result" text,
	"amount_cents" integer,
	"link_sent_at" timestamp with time zone,
	"source" text DEFAULT 'mark' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_sample_tests" ADD CONSTRAINT "lead_sample_tests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sample_tests" ADD CONSTRAINT "lead_sample_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sends" ADD CONSTRAINT "lead_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sends" ADD CONSTRAINT "lead_sends_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_sample_tests_tenant" ON "lead_sample_tests" USING btree ("tenant_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sends_one" ON "lead_sends" USING btree ("lead_id","channel");--> statement-breakpoint
CREATE INDEX "lead_sends_tenant" ON "lead_sends" USING btree ("tenant_id","channel","variant");
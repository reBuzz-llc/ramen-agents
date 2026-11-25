CREATE TABLE "lead_rich_text" (
	"lead_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"field" text NOT NULL,
	"html" text NOT NULL,
	"plain_hash" text NOT NULL,
	"user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_rich_text_lead_id_field_pk" PRIMARY KEY("lead_id","field")
);
--> statement-breakpoint
ALTER TABLE "lead_rich_text" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_rich_text" ADD CONSTRAINT "lead_rich_text_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_rich_text" ADD CONSTRAINT "lead_rich_text_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_rich_text" ADD CONSTRAINT "lead_rich_text_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_rich_text_tenant" ON "lead_rich_text" USING btree ("tenant_id");
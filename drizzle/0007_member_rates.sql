CREATE TABLE "member_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" text NOT NULL,
	"hourly_cents" integer,
	"outcome_bonus_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_rates_one_per_day" ON "member_rates" USING btree ("tenant_id","user_id","effective_from");--> statement-breakpoint
CREATE INDEX "member_rates_person" ON "member_rates" USING btree ("tenant_id","user_id");
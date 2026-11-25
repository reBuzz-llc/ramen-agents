CREATE TABLE "billing_benches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"item_id" text NOT NULL,
	"why" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"filed_by" text NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid,
	"cleared_name" text,
	"cleared_role" text
);
--> statement-breakpoint
ALTER TABLE "billing_benches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ask_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"text_hash" text NOT NULL,
	"target" text NOT NULL,
	"by_user" uuid,
	"by_name" text NOT NULL,
	"by_role" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "owner_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"target" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"channel" text NOT NULL,
	"text_hash" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"filed_by" text NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_asks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_benches" ADD CONSTRAINT "billing_benches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_benches" ADD CONSTRAINT "billing_benches_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_answers" ADD CONSTRAINT "owner_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_answers" ADD CONSTRAINT "owner_answers_ask_id_owner_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."owner_asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_answers" ADD CONSTRAINT "owner_answers_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_answers" ADD CONSTRAINT "owner_answers_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_benches_one" ON "billing_benches" USING btree ("tenant_id","host","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_answers_live" ON "owner_answers" USING btree ("ask_id","generation") WHERE withdrawn_at is null;--> statement-breakpoint
CREATE INDEX "owner_answers_ask" ON "owner_answers" USING btree ("ask_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_asks_one" ON "owner_asks" USING btree ("tenant_id","kind","subject");
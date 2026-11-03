CREATE TABLE "claims" (
	"tenant_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_tenant_id_page_id_pk" PRIMARY KEY("tenant_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
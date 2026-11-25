CREATE TABLE "session_presses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"row_kind" text NOT NULL,
	"row_id" text NOT NULL,
	"session_hash" text,
	"session_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_presses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_presses" ADD CONSTRAINT "session_presses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_presses" ADD CONSTRAINT "session_presses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_presses_row" ON "session_presses" USING btree ("tenant_id","row_kind","row_id");--> statement-breakpoint
CREATE INDEX "session_presses_session" ON "session_presses" USING btree ("session_hash","at");
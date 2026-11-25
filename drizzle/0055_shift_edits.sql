CREATE TABLE "shift_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"old_end" timestamp with time zone,
	"new_end" timestamp with time zone NOT NULL,
	"by_user" uuid,
	"by_name" text NOT NULL,
	"by_role" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_edits" ADD CONSTRAINT "shift_edits_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_edits_user" ON "shift_edits" USING btree ("tenant_id","user_id","at");--> statement-breakpoint
CREATE INDEX "shift_edits_shift" ON "shift_edits" USING btree ("shift_id","at");
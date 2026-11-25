CREATE TABLE "treasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item" text NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"how_to" text DEFAULT '' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treasures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treasures" ADD CONSTRAINT "treasures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treasures_item" ON "treasures" USING btree ("tenant_id","item","added_at");
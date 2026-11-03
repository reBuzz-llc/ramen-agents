CREATE SEQUENCE "public"."tasks_rev_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "task_cells" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"column" text NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"actor_kind" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_user_id" uuid,
	"via" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'applied' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "task_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"actor" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notion_page_id" text,
	"notion_url" text,
	"notion_uid" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'Not started' NOT NULL,
	"priority" text,
	"assignees" text[],
	"due" date,
	"projects" text[],
	"blocker" text,
	"files" text[],
	"details" text,
	"checklist" jsonb,
	"standing" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"last_actor_name" text,
	"last_actor_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rev" bigint DEFAULT nextval('tasks_rev_seq') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_cells" ADD CONSTRAINT "task_cells_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_cells" ADD CONSTRAINT "task_cells_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_cells" ADD CONSTRAINT "task_cells_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flags" ADD CONSTRAINT "task_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flags" ADD CONSTRAINT "task_flags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_cells_task" ON "task_cells" USING btree ("task_id","column","id");--> statement-breakpoint
CREATE INDEX "task_cells_tenant" ON "task_cells" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_flags_rule" ON "task_flags" USING btree ("task_id","rule");--> statement-breakpoint
CREATE INDEX "task_flags_open" ON "task_flags" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_notion_page" ON "tasks" USING btree ("tenant_id","notion_page_id");--> statement-breakpoint
CREATE INDEX "tasks_rev" ON "tasks" USING btree ("tenant_id","rev");--> statement-breakpoint
CREATE INDEX "tasks_status" ON "tasks" USING btree ("tenant_id","status");
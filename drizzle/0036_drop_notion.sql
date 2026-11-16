-- Notion is gone from ramen-agents v0.2.0: its connection, its cached board and the Notion ids on leads, tasks and people.
ALTER TABLE "board_rows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notion_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "board_rows" CASCADE;--> statement-breakpoint
DROP TABLE "notion_connections" CASCADE;--> statement-breakpoint
DROP INDEX "leads_notion_page";--> statement-breakpoint
DROP INDEX "tasks_notion_page";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "notion_page_id";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "notion_url";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "notion_uid";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "notion_page_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "notion_url";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "notion_uid";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "notion_user_id";
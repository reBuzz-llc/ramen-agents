DROP INDEX "leads_notion_page";--> statement-breakpoint
DROP INDEX "tasks_notion_page";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "notion_page_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "notion_page_id";
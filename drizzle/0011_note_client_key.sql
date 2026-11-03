ALTER TABLE "shift_notes" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_notes_client_key" ON "shift_notes" USING btree ("user_id","client_key");
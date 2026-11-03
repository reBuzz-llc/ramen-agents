CREATE INDEX "claims_person" ON "claims" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "outcomes_person_at" ON "outcomes" USING btree ("tenant_id","user_id","at");
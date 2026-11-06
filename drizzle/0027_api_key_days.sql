CREATE TABLE "api_key_days" (
	"key_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"not_modified" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "api_key_days_key_id_day_pk" PRIMARY KEY("key_id","day")
);
--> statement-breakpoint
ALTER TABLE "api_key_days" ADD CONSTRAINT "api_key_days_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
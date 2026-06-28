CREATE TABLE "integration_auto_disable_claim" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"integration_id" text NOT NULL,
	"import_run_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_auto_disable_claim" ADD CONSTRAINT "integration_auto_disable_claim_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_auto_disable_claim_integration_id_idx" ON "integration_auto_disable_claim" USING btree ("integration_id");

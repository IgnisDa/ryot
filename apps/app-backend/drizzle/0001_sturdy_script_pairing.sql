DROP TABLE "entity_schema_sandbox_script";
--> statement-breakpoint
CREATE TABLE "entity_schema_sandbox_script" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"entity_schema_id" text NOT NULL,
	"search_sandbox_script_id" text NOT NULL,
	"details_sandbox_script_id" text NOT NULL,
	CONSTRAINT "entity_schema_sandbox_script_unique" UNIQUE("entity_schema_id","search_sandbox_script_id","details_sandbox_script_id")
);
--> statement-breakpoint
ALTER TABLE "entity_schema_sandbox_script" ADD CONSTRAINT "entity_schema_sandbox_script_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_schema_sandbox_script" ADD CONSTRAINT "entity_schema_sandbox_script_search_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("search_sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_schema_sandbox_script" ADD CONSTRAINT "entity_schema_sandbox_script_details_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("details_sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entity_schema_sandbox_script_entity_schema_id_idx" ON "entity_schema_sandbox_script" USING btree ("entity_schema_id");
--> statement-breakpoint
CREATE INDEX "entity_schema_sandbox_script_search_script_id_idx" ON "entity_schema_sandbox_script" USING btree ("search_sandbox_script_id");
--> statement-breakpoint
CREATE INDEX "entity_schema_sandbox_script_details_script_id_idx" ON "entity_schema_sandbox_script" USING btree ("details_sandbox_script_id");

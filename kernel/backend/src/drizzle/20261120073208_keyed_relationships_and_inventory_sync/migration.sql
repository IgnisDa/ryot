ALTER TABLE "relationship" DROP CONSTRAINT "relationship_identity_unique";--> statement-breakpoint
ALTER TABLE "definition_relationship_schema" ADD COLUMN "keyed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "source_key" text DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "integration" DROP COLUMN "sync_ownership";--> statement-breakpoint
ALTER TABLE "definition_integration_provider" DROP COLUMN "supports_ownership_sync";--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_source_key_owner_unique" UNIQUE("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_identity_unique" ON "relationship" ((case when "user_id" is null then '0' else '1' || "user_id" end),"source_entity_id","target_entity_id","relationship_schema_slug",(case when "relationship_schema_plugin_id" is null then '0' else '1' || "relationship_schema_plugin_id" end)) WHERE "key" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_key_unique" ON "relationship" ("user_id","source_entity_id","relationship_schema_slug",(case when "relationship_schema_plugin_id" is null then '0' else '1' || "relationship_schema_plugin_id" end),"key") WHERE "key" is not null;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_key_user_scope" CHECK ("key" is null or "user_id" is not null);
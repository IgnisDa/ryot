ALTER TABLE "publication" RENAME COLUMN "source" TO "definition";--> statement-breakpoint
UPDATE "publication" SET "definition" = jsonb_build_object('page', jsonb_build_object('kind', 'kernel', 'name', 'publication'), 'mode', 'live', 'arguments', jsonb_build_object('source', "definition"::text));--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "snapshot_artifact_hash" text;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_snapshot_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("snapshot_artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_page_owner_fk" FOREIGN KEY ("page_id","user_id") REFERENCES "page"("id","user_id") ON DELETE RESTRICT;
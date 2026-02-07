ALTER TABLE "event" DROP CONSTRAINT "event_session_entity_id_entity_id_fk";
--> statement-breakpoint
DROP INDEX "event_session_entity_id_idx";--> statement-breakpoint
ALTER TABLE "event" DROP COLUMN "session_entity_id";
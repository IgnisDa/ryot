ALTER TABLE "assistant_turn" DROP CONSTRAINT "assistant_turn_conversation_id_request_id_unique";--> statement-breakpoint
ALTER TABLE "assistant_turn" ADD CONSTRAINT "assistant_turn_user_id_request_id_unique" UNIQUE("user_id","request_id");--> statement-breakpoint
CREATE INDEX "assistant_message_turn_sequence_idx" ON "assistant_message" ("turn_id","sequence");--> statement-breakpoint
CREATE INDEX "assistant_turn_conversation_created_idx" ON "assistant_turn" ("conversation_id","created_at");
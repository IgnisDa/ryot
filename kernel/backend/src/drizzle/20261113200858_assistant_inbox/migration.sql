CREATE TABLE "assistant_inbox" (
	"text" text NOT NULL,
	"id" text PRIMARY KEY,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"delivered_at" timestamp(3) with time zone,
	"request_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_inbox_user_id_request_id_unique" UNIQUE("user_id","request_id")
);
--> statement-breakpoint
CREATE INDEX "assistant_inbox_turn_idx" ON "assistant_inbox" ("turn_id");--> statement-breakpoint
ALTER TABLE "assistant_inbox" ADD CONSTRAINT "assistant_inbox_7kTv54GGAwnu_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;
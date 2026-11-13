CREATE TABLE "assistant_tool_output" (
	"text" text NOT NULL,
	"id" text PRIMARY KEY,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "prompt_characters" integer;--> statement-breakpoint
ALTER TABLE "assistant_provider" ADD COLUMN "context_window" integer;--> statement-breakpoint
ALTER TABLE "assistant_provider" ADD COLUMN "max_output_tokens" integer;--> statement-breakpoint
CREATE INDEX "assistant_tool_output_turn_idx" ON "assistant_tool_output" ("turn_id");--> statement-breakpoint
ALTER TABLE "assistant_tool_output" ADD CONSTRAINT "assistant_tool_output_RBIfuTAFHrJc_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;
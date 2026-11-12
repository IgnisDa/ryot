CREATE TABLE "assistant_conversation" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "assistant_conversation_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" text PRIMARY KEY,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"conversation_id" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	CONSTRAINT "assistant_message_conversation_id_sequence_unique" UNIQUE("conversation_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "assistant_provider" (
	"model" text NOT NULL,
	"base_url" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"encrypted_api_key" jsonb,
	"user_id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "assistant_tool_call" (
	"id" text PRIMARY KEY,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"decided_at" timestamp(3) with time zone,
	"round" integer NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"position" integer NOT NULL,
	"conversation_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"result" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"call" jsonb NOT NULL,
	"decision" text,
	CONSTRAINT "assistant_tool_call_turn_id_round_position_unique" UNIQUE("turn_id","round","position")
);
--> statement-breakpoint
CREATE TABLE "assistant_turn" (
	"failure" jsonb,
	"text" text NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"request_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	CONSTRAINT "assistant_turn_conversation_id_request_id_unique" UNIQUE("conversation_id","request_id"),
	CONSTRAINT "assistant_turn_id_conversation_id_user_id_unique" UNIQUE("id","conversation_id","user_id"),
	CONSTRAINT "assistant_turn_status" CHECK ("status" in ('queued', 'running', 'awaiting-approval', 'completed', 'failed', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_turn_active_unique" ON "assistant_turn" ("conversation_id") WHERE "status" in ('queued', 'running', 'awaiting-approval');--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_5nOssrZ23nTD_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_provider" ADD CONSTRAINT "assistant_provider_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_tool_call" ADD CONSTRAINT "assistant_tool_call_kwOjAAwu8Gpn_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_turn" ADD CONSTRAINT "assistant_turn_dX1hPmBw1nmZ_fkey" FOREIGN KEY ("conversation_id","user_id") REFERENCES "assistant_conversation"("id","user_id") ON DELETE CASCADE;
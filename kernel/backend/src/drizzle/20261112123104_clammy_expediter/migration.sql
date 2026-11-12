CREATE TABLE "agent_script_execution" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"allow_writes" boolean NOT NULL,
	"principal" jsonb,
	"result" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_script_execution" ADD CONSTRAINT "agent_script_execution_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
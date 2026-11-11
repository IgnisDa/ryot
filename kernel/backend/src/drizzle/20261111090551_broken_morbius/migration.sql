CREATE TABLE "page" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"authority_revision" integer DEFAULT 1 NOT NULL,
	"draft_definition" jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"draft_definition_hash" text NOT NULL,
	"draft_compiled_revision" integer,
	"draft_artifact_hash" text,
	"published_definition" jsonb,
	"published_revision" integer,
	"published_definition_hash" text,
	"published_artifact_hash" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "page_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "client_artifact" ADD COLUMN "page_declaration_hash" text;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_draft_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("draft_artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_published_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("published_artifact_hash") REFERENCES "client_artifact"("hash");
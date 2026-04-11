CREATE TABLE "import_run" (
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"total_items" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"imported_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_failure" (
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"item_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"source_label" text,
	"source_identifier" text,
	"entity_schema_slug" text,
	"event_schema_slug" text,
	"run_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_failure" ADD CONSTRAINT "import_run_failure_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_run_user_id_created_at_idx" ON "import_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_run_failure_run_id_created_at_idx" ON "import_run_failure" USING btree ("run_id","created_at");

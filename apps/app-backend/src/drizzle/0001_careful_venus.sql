CREATE TABLE "integration" (
	"name" text,
	"lot" text NOT NULL,
	"provider" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"sync_ownership" boolean DEFAULT false NOT NULL,
	"last_finished_at" timestamp with time zone,
	"minimum_progress" numeric DEFAULT '2' NOT NULL,
	"maximum_progress" numeric DEFAULT '95' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"extra_settings" jsonb NOT NULL,
	"provider_specifics" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_schema_trigger" ADD COLUMN "position" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_schema_trigger" ADD COLUMN "phase" text DEFAULT 'after_create' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN "integration_id" text;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_user_id_created_at_idx" ON "integration" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_user_id_provider_idx" ON "integration" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "integration_lot_is_disabled_idx" ON "integration" USING btree ("lot","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_provider_is_disabled_idx" ON "integration" USING btree ("provider","is_disabled");--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_run_integration_id_created_at_idx" ON "import_run" USING btree ("integration_id","created_at" DESC NULLS LAST);
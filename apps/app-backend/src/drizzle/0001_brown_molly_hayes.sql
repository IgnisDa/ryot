CREATE TABLE "event_schema_trigger" (
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"event_schema_id" text NOT NULL,
	"sandbox_script_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_schema_trigger_user_unique" UNIQUE("user_id","event_schema_id","sandbox_script_id")
);
--> statement-breakpoint
ALTER TABLE "event_schema_trigger" ADD CONSTRAINT "event_schema_trigger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schema_trigger" ADD CONSTRAINT "event_schema_trigger_event_schema_id_event_schema_id_fk" FOREIGN KEY ("event_schema_id") REFERENCES "public"."event_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schema_trigger" ADD CONSTRAINT "event_schema_trigger_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_schema_trigger_user_id_idx" ON "event_schema_trigger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_schema_trigger_event_schema_id_idx" ON "event_schema_trigger" USING btree ("event_schema_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_schema_trigger_builtin_unique" ON "event_schema_trigger" USING btree ("event_schema_id","sandbox_script_id") WHERE "event_schema_trigger"."user_id" is null;
CREATE TABLE "automation_rule" (
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"operation" text NOT NULL,
	"position" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"entity_schema_id" text,
	"event_schema_id" text,
	"relationship_schema_id" text,
	"signal_schema_id" text,
	"sandbox_script_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rule_kind_check" CHECK ("automation_rule"."kind" in ('policy', 'subscription')),
	CONSTRAINT "automation_rule_operation_check" CHECK ("automation_rule"."operation" in ('create', 'update', 'delete', 'signal')),
	CONSTRAINT "automation_rule_one_target_check" CHECK (num_nonnulls("automation_rule"."entity_schema_id", "automation_rule"."event_schema_id", "automation_rule"."relationship_schema_id", "automation_rule"."signal_schema_id") = 1),
	CONSTRAINT "automation_rule_target_operation_check" CHECK ((("automation_rule"."signal_schema_id" is not null and "automation_rule"."kind" = 'subscription' and "automation_rule"."operation" = 'signal') or ("automation_rule"."signal_schema_id" is null and "automation_rule"."operation" <> 'signal'))),
	CONSTRAINT "automation_rule_position_check" CHECK ("automation_rule"."kind" = 'policy' or "automation_rule"."position" is null)
);
--> statement-breakpoint
CREATE TABLE "subscription_run" (
	"id" text PRIMARY KEY NOT NULL,
	"original_rule_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"record_id" text,
	"operation" text NOT NULL,
	"source_kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" jsonb,
	"sandbox_error" jsonb,
	"logs" jsonb,
	"returned_value" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"script_updated_at" timestamp with time zone,
	"execution_user_id" text,
	"rule_id" text,
	"signal_id" text,
	CONSTRAINT "subscription_run_operation_check" CHECK ("subscription_run"."operation" in ('create', 'update', 'delete', 'signal')),
	CONSTRAINT "subscription_run_source_kind_check" CHECK ("subscription_run"."source_kind" in ('entity', 'event', 'relationship', 'signal')),
	CONSTRAINT "subscription_run_status_check" CHECK ("subscription_run"."status" in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "subscription_run_source_check" CHECK ((("subscription_run"."source_kind" = 'signal' and "subscription_run"."operation" = 'signal' and "subscription_run"."signal_id" is not null and "subscription_run"."record_id" is null) or ("subscription_run"."source_kind" <> 'signal' and "subscription_run"."operation" <> 'signal' and "subscription_run"."signal_id" is null and "subscription_run"."record_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_event_schema_id_event_schema_id_fk" FOREIGN KEY ("event_schema_id") REFERENCES "public"."event_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_relationship_schema_id_relationship_schema_id_fk" FOREIGN KEY ("relationship_schema_id") REFERENCES "public"."relationship_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_signal_schema_id_signal_schema_id_fk" FOREIGN KEY ("signal_schema_id") REFERENCES "public"."signal_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_execution_user_id_user_id_fk" FOREIGN KEY ("execution_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_user_id_idx" ON "automation_rule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_rule_entity_schema_id_idx" ON "automation_rule" USING btree ("entity_schema_id");--> statement-breakpoint
CREATE INDEX "automation_rule_event_schema_id_idx" ON "automation_rule" USING btree ("event_schema_id");--> statement-breakpoint
CREATE INDEX "automation_rule_relationship_schema_id_idx" ON "automation_rule" USING btree ("relationship_schema_id");--> statement-breakpoint
CREATE INDEX "automation_rule_signal_schema_id_idx" ON "automation_rule" USING btree ("signal_schema_id");--> statement-breakpoint
CREATE INDEX "automation_rule_sandbox_script_id_idx" ON "automation_rule" USING btree ("sandbox_script_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_user_entity_schema_unique" ON "automation_rule" USING btree ("user_id","entity_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is not null and "automation_rule"."entity_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_global_entity_schema_unique" ON "automation_rule" USING btree ("entity_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is null and "automation_rule"."entity_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_user_event_schema_unique" ON "automation_rule" USING btree ("user_id","event_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is not null and "automation_rule"."event_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_global_event_schema_unique" ON "automation_rule" USING btree ("event_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is null and "automation_rule"."event_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_user_relationship_schema_unique" ON "automation_rule" USING btree ("user_id","relationship_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is not null and "automation_rule"."relationship_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_global_relationship_schema_unique" ON "automation_rule" USING btree ("relationship_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is null and "automation_rule"."relationship_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_user_signal_schema_unique" ON "automation_rule" USING btree ("user_id","signal_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is not null and "automation_rule"."signal_schema_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_global_signal_schema_unique" ON "automation_rule" USING btree ("signal_schema_id","operation","sandbox_script_id") WHERE "automation_rule"."user_id" is null and "automation_rule"."signal_schema_id" is not null;--> statement-breakpoint
CREATE INDEX "subscription_run_execution_user_id_idx" ON "subscription_run" USING btree ("execution_user_id");--> statement-breakpoint
CREATE INDEX "subscription_run_rule_id_idx" ON "subscription_run" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "subscription_run_original_rule_id_idx" ON "subscription_run" USING btree ("original_rule_id");--> statement-breakpoint
CREATE INDEX "subscription_run_signal_id_idx" ON "subscription_run" USING btree ("signal_id");
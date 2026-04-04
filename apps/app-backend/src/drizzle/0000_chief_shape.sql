CREATE TABLE "account" (
	"scope" text,
	"id_token" text,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"name" text,
	"start" text,
	"prefix" text,
	"metadata" text,
	"permissions" text,
	"remaining" integer,
	"key" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"refill_amount" integer,
	"refill_interval" integer,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"config_id" text DEFAULT 'default' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_request" timestamp with time zone,
	"last_refill_at" timestamp with time zone,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reference_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"external_id" text,
	"name" text NOT NULL,
	"populated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_schema_slug" text NOT NULL,
	"sandbox_script_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_user_schema_script_external_id_unique" UNIQUE("user_id","external_id","entity_schema_slug","sandbox_script_id")
);
--> statement-breakpoint
CREATE TABLE "entity_translation" (
	"name" text,
	"language" text NOT NULL,
	"properties" jsonb,
	"populated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_translation_entity_language_unique" UNIQUE("entity_id","language")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"event_schema_slug" text NOT NULL,
	"entity_id" text NOT NULL,
	"session_entity_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"error_summary" text,
	"total_items" integer,
	"progress" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"imported_items" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"integration_id" text,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_failure" (
	"source_label" text,
	"event_schema_slug" text,
	"source_identifier" text,
	"entity_schema_slug" text,
	"message" text NOT NULL,
	"item_index" integer NOT NULL,
	"context" jsonb,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"name" text,
	"lot" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"sync_ownership" boolean DEFAULT false NOT NULL,
	"minimum_progress" numeric DEFAULT '2' NOT NULL,
	"maximum_progress" numeric DEFAULT '95' NOT NULL,
	"last_finished_at" timestamp with time zone,
	"extra_settings" jsonb NOT NULL,
	"provider_specifics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_auto_disable_claim" (
	"import_run_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"integration_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"is_disabled" boolean DEFAULT false NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_specifics" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscription_state" (
	"signal_schema_slug" text NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin" (
	"status" text NOT NULL,
	"version" text NOT NULL,
	"slug" text PRIMARY KEY NOT NULL,
	"source_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"compiled_hashes" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_state" (
	"plugin_slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_state_user_slug_unique" UNIQUE("user_id","plugin_slug")
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_entity_id" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"relationship_schema_slug" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	CONSTRAINT "relationship_user_source_target_schema_unique" UNIQUE("user_id","source_entity_id","target_entity_id","relationship_schema_slug")
);
--> statement-breakpoint
CREATE TABLE "sandbox_script" (
	"content_hash" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"compiled_code" text NOT NULL,
	"compiled_format" smallint DEFAULT 1 NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plugin_slug" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_script_plugin_slug_content_hash_unique" UNIQUE("plugin_slug","slug","content_hash")
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"plugin_slug" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"accent_color" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"query_document" jsonb NOT NULL,
	"display_configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "saved_view_state" (
	"saved_view_slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_state_user_slug_unique" UNIQUE("user_id","saved_view_slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"ip_address" text,
	"user_agent" text,
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_schema_slug" text NOT NULL,
	"origin" jsonb NOT NULL,
	"properties" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"subject_entity_id" text
);
--> statement-breakpoint
CREATE TABLE "signal_recipient" (
	"user_id" text NOT NULL,
	"signal_id" text NOT NULL,
	CONSTRAINT "signal_recipient_signal_id_user_id_pk" PRIMARY KEY("signal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_run" (
	"record_id" text,
	"rule_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"sandbox_script_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"logs" jsonb,
	"timing" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"rule_metadata" jsonb,
	"sandbox_error" jsonb,
	"skip_reason" jsonb,
	"returned_value" jsonb,
	"operation" text NOT NULL,
	"script_updated_at" timestamp with time zone,
	"source_kind" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"signal_id" text,
	"execution_user_id" text,
	CONSTRAINT "subscription_run_operation_check" CHECK ("subscription_run"."operation" in ('create', 'update', 'delete', 'signal')),
	CONSTRAINT "subscription_run_source_kind_check" CHECK ("subscription_run"."source_kind" in ('entity', 'event', 'relationship', 'signal')),
	CONSTRAINT "subscription_run_status_check" CHECK ("subscription_run"."status" in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "subscription_run_source_check" CHECK ((("subscription_run"."source_kind" = 'signal' and "subscription_run"."operation" = 'signal' and "subscription_run"."signal_id" is not null and "subscription_run"."record_id" is null) or ("subscription_run"."source_kind" <> 'signal' and "subscription_run"."operation" <> 'signal' and "subscription_run"."signal_id" is null and "subscription_run"."record_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"image" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"two_factor_enabled" boolean,
	"email" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"bootstrap_completed_at" timestamp with time zone,
	"preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"identifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_translation" ADD CONSTRAINT "entity_translation_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_failure" ADD CONSTRAINT "import_run_failure_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_auto_disable_claim" ADD CONSTRAINT "integration_auto_disable_claim_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscription_state" ADD CONSTRAINT "notification_subscription_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_state" ADD CONSTRAINT "plugin_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_entity_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_plugin_slug_plugin_slug_fk" FOREIGN KEY ("plugin_slug") REFERENCES "public"."plugin"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_state" ADD CONSTRAINT "saved_view_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_subject_entity_id_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_execution_user_id_user_id_fk" FOREIGN KEY ("execution_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "entity_user_id_idx" ON "entity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_external_id_idx" ON "entity" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_slug_idx" ON "entity" USING btree ("entity_schema_slug");--> statement-breakpoint
CREATE INDEX "entity_properties_idx" ON "entity" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "entity_sandbox_script_id_idx" ON "entity" USING btree ("sandbox_script_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_external_id_unique" ON "entity" USING btree ("external_id","entity_schema_slug","sandbox_script_id") WHERE "entity"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_no_script_external_id_unique" ON "entity" USING btree ("external_id","entity_schema_slug") WHERE "entity"."user_id" IS NULL AND "entity"."sandbox_script_id" IS NULL;--> statement-breakpoint
CREATE INDEX "entity_translation_entity_id_idx" ON "entity_translation" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "event_user_id_idx" ON "event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_entity_id_idx" ON "event" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "event_event_schema_slug_idx" ON "event" USING btree ("event_schema_slug");--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" USING btree ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_properties_idx" ON "event" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "event_user_entity_schema_slugx" ON "event" USING btree ("user_id","entity_id","event_schema_slug");--> statement-breakpoint
CREATE INDEX "import_run_user_id_created_at_idx" ON "import_run" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_integration_id_created_at_idx" ON "import_run" USING btree ("integration_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_failure_run_id_created_at_idx" ON "import_run_failure" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_user_id_created_at_idx" ON "integration" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_user_id_provider_idx" ON "integration" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "integration_lot_is_disabled_idx" ON "integration" USING btree ("lot","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_provider_is_disabled_idx" ON "integration" USING btree ("provider","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_auto_disable_claim_integration_id_idx" ON "integration_auto_disable_claim" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_created_at_idx" ON "notification_channel" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_is_disabled_idx" ON "notification_channel" USING btree ("user_id","is_disabled");--> statement-breakpoint
CREATE INDEX "notification_subscription_state_user_id_idx" ON "notification_subscription_state" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscription_state_user_signal_unique" ON "notification_subscription_state" USING btree ("user_id","signal_schema_slug");--> statement-breakpoint
CREATE INDEX "plugin_state_user_id_idx" ON "plugin_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "relationship_schema_slug_idx" ON "relationship" USING btree ("relationship_schema_slug");--> statement-breakpoint
CREATE INDEX "relationship_source_entity_id_idx" ON "relationship" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_target_entity_id_idx" ON "relationship" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_properties_idx" ON "relationship" USING gin ("properties");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_global_source_target_schema_unique" ON "relationship" USING btree ("source_entity_id","target_entity_id","relationship_schema_slug") WHERE "relationship"."user_id" is null;--> statement-breakpoint
CREATE INDEX "sandbox_script_plugin_slug_idx" ON "sandbox_script" USING btree ("plugin_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_script_kernel_slug_content_hash_unique" ON "sandbox_script" USING btree ("slug","content_hash") WHERE "sandbox_script"."plugin_slug" is null;--> statement-breakpoint
CREATE INDEX "saved_view_user_id_idx" ON "saved_view" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_plugin_slug_idx" ON "saved_view" USING btree ("plugin_slug");--> statement-breakpoint
CREATE INDEX "saved_view_state_user_id_idx" ON "saved_view_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_actor_user_id_idx" ON "signal" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "signal_signal_schema_slug_idx" ON "signal" USING btree ("signal_schema_slug");--> statement-breakpoint
CREATE INDEX "signal_subject_entity_id_idx" ON "signal" USING btree ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "signal_recipient_user_id_idx" ON "signal_recipient" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_run_execution_user_id_idx" ON "subscription_run" USING btree ("execution_user_id");--> statement-breakpoint
CREATE INDEX "subscription_run_rule_id_idx" ON "subscription_run" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "subscription_run_signal_id_idx" ON "subscription_run" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
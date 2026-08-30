CREATE TABLE "account" (
	"scope" text,
	"id_token" text,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id" text PRIMARY KEY,
	"issuer" text NOT NULL,
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
	"id" text PRIMARY KEY,
	"refill_amount" integer,
	"refill_interval" integer,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"expires_at" timestamp with time zone,
	"config_id" text DEFAULT 'default' NOT NULL,
	"last_request" timestamp with time zone,
	"last_refill_at" timestamp with time zone,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reference_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_occurrence" (
	"record_id" text,
	"origin" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"operation" text NOT NULL,
	"population" jsonb,
	"source" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_kind" text NOT NULL,
	"signal_id" text,
	CONSTRAINT "automation_occurrence_source_check" CHECK ((("source_kind" = 'signal' and "operation" = 'signal' and "signal_id" is not null and "record_id" is null) or ("source_kind" <> 'signal' and "operation" <> 'signal' and "signal_id" is null and "record_id" is not null))),
	CONSTRAINT "automation_occurrence_source_kind_check" CHECK ("source_kind" in ('entity', 'event', 'relationship', 'signal', 'provider-entity-import'))
);
--> statement-breakpoint
CREATE TABLE "backup_run" (
	"artifact_key" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"kind" text NOT NULL,
	"finished_at" timestamp with time zone,
	"artifact_provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "client_page_build" (
	"kernel_renderer_name" text,
	"graph_hash" text NOT NULL,
	"published_hash" text NOT NULL,
	"graph_identity" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	"renderer_id" text,
	"user_id" text NOT NULL,
	"artifact_hash" text NOT NULL,
	CONSTRAINT "client_page_build_graph_unique" UNIQUE("renderer_id","published_hash","graph_hash"),
	CONSTRAINT "client_page_build_kernel_graph_unique" UNIQUE("user_id","kernel_renderer_name","published_hash","graph_hash")
);
--> statement-breakpoint
CREATE TABLE "client_renderer" (
	"published_hash" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"published_revision" integer,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"published_definition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_definition" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"published_artifact_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_renderer_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"external_id" text,
	"name" text NOT NULL,
	"entity_schema_slug" text NOT NULL,
	"populated_at" timestamp with time zone,
	"origin" jsonb,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"provider_id" text,
	"entity_schema_plugin_id" text,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_translation" (
	"name" text,
	"language" text NOT NULL,
	"populated_at" timestamp with time zone,
	"properties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_translation_entity_language_unique" UNIQUE("entity_id","language")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"event_schema_slug" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"session_entity_id" text,
	"event_schema_plugin_id" text,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"total_items" integer,
	"progress" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"imported_items" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"integration_lot" text,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"failure_reason" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_summary" jsonb DEFAULT '{}' NOT NULL,
	"integration_id" text,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"plugin_installation_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_failure" (
	"source_label" text,
	"event_schema_slug" text,
	"source_identifier" text,
	"entity_schema_slug" text,
	"item_index" integer NOT NULL,
	"stage" text NOT NULL,
	"reason" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"name" text,
	"plugin_installation_id" text NOT NULL,
	"lot" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"sync_ownership" boolean DEFAULT false NOT NULL,
	"minimum_progress" numeric DEFAULT '2' NOT NULL,
	"last_finished_at" timestamp with time zone,
	"maximum_progress" numeric DEFAULT '95' NOT NULL,
	"provider" text NOT NULL,
	"extra_settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_specifics" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_auto_disable_claim" (
	"import_run_id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"integration_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"alg" text,
	"crv" text,
	"id" text PRIMARY KEY,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_asset" (
	"key" text,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_user_id" text NOT NULL,
	CONSTRAINT "managed_asset_pkey" PRIMARY KEY("provider","key")
);
--> statement-breakpoint
CREATE TABLE "migration_report" (
	"count" integer,
	"phase" text NOT NULL,
	"message" text NOT NULL,
	"seq" serial PRIMARY KEY,
	"elapsed_seconds" double precision,
	"code" text,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_report_level_check" CHECK ("level" in ('info', 'warning')),
	CONSTRAINT "migration_report_warning_code_check" CHECK ("level" <> 'warning' or "code" is not null)
);
--> statement-breakpoint
CREATE TABLE "migration_report_detail" (
	"seq" serial PRIMARY KEY,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"description" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"platform_specifics" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscription_state" (
	"signal_schema_slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signal_schema_plugin_id" text,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "notification_subscription_state_user_signal_unique" UNIQUE NULLS NOT DISTINCT("user_id","signal_schema_slug","signal_schema_plugin_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"reference_id" text,
	"token" text UNIQUE,
	"id" text PRIMARY KEY,
	"resources" text[],
	"authorization_code_id" text,
	"scopes" text[] NOT NULL,
	"requested_user_info_claims" text[],
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"user_id" text,
	"session_id" text,
	"client_id" text NOT NULL,
	"refresh_id" text
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"tos" text,
	"uri" text,
	"icon" text,
	"jwks" text,
	"name" text,
	"policy" text,
	"jwks_uri" text,
	"software_id" text,
	"reference_id" text,
	"subject_type" text,
	"client_secret" text,
	"scopes" text[],
	"skip_consent" boolean,
	"require_pkce" boolean,
	"id" text PRIMARY KEY,
	"software_version" text,
	"application_type" text,
	"contacts" text[],
	"client_discovery_id" text,
	"software_statement" text,
	"grant_types" text[],
	"enable_end_session" boolean,
	"backchannel_logout_uri" text,
	"response_types" text[],
	"token_endpoint_auth_method" text,
	"disabled" boolean DEFAULT false,
	"client_id" text NOT NULL UNIQUE,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_session_required" boolean,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"metadata" jsonb,
	"client_credentials_scopes" text[] DEFAULT '{}'::text[],
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone,
	"metadata" jsonb,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"reference_id" text,
	"id" text PRIMARY KEY,
	"resources" text[],
	"scopes" text[] NOT NULL,
	"requested_user_info_claims" text[],
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" text,
	"client_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"reference_id" text,
	"id" text PRIMARY KEY,
	"resources" text[],
	"authorization_code_id" text,
	"rotation_replay_response" text,
	"token" text NOT NULL UNIQUE,
	"scopes" text[] NOT NULL,
	"requested_user_info_claims" text[],
	"revoked" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"confirmation" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"rotation_replay_expires_at" timestamp with time zone,
	"session_id" text,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"signing_key_id" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY,
	"signing_algorithm" text,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"allowed_scopes" text[],
	"disabled" boolean DEFAULT false,
	"policy_version" integer DEFAULT 1,
	"identifier" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"metadata" jsonb,
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "plugin" (
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"version" text NOT NULL,
	"source_hash" text NOT NULL,
	"scope" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"compiled_hashes" jsonb NOT NULL,
	"owner_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "plugin_scope_owner_check" CHECK (("scope" = 'system' and "owner_id" is null) or ("scope" = 'user' and "owner_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "plugin_client_artifact" (
	"format" smallint NOT NULL,
	"api_version" smallint NOT NULL,
	"hash" text PRIMARY KEY,
	"bridge_version" smallint NOT NULL,
	"compiler_version" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_client_artifact_file" (
	"name" text,
	"contents" bytea NOT NULL,
	"content_type" text NOT NULL,
	"artifact_hash" text,
	CONSTRAINT "plugin_client_artifact_file_pkey" PRIMARY KEY("artifact_hash","name")
);
--> statement-breakpoint
CREATE TABLE "plugin_installation" (
	"health_reason" text,
	"home_saved_view_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"user_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"health" text DEFAULT 'ready' NOT NULL,
	CONSTRAINT "plugin_installation_user_plugin_unique" UNIQUE("user_id","plugin_id"),
	CONSTRAINT "plugin_installation_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "plugin_source_file" (
	"path" text,
	"contents" bytea NOT NULL,
	"plugin_id" text,
	CONSTRAINT "plugin_source_file_pkey" PRIMARY KEY("plugin_id","path")
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"relationship_schema_slug" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"relationship_schema_plugin_id" text,
	"id" text PRIMARY KEY,
	"source_entity_id" text NOT NULL,
	"target_entity_id" text NOT NULL,
	CONSTRAINT "relationship_identity_unique" UNIQUE NULLS NOT DISTINCT("user_id","source_entity_id","target_entity_id","relationship_schema_slug","relationship_schema_plugin_id")
);
--> statement-breakpoint
CREATE TABLE "sandbox_provider" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"root_entity_schema_slug" text NOT NULL,
	"information" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plugin_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_provider_plugin_id_unique" UNIQUE("plugin_id","slug")
);
--> statement-breakpoint
CREATE TABLE "sandbox_provider_operation" (
	"options_schema" jsonb,
	"operation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	"script_id" text NOT NULL CONSTRAINT "sandbox_provider_operation_script_id_unique" UNIQUE,
	"provider_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_provider_operation_provider_operation_unique" UNIQUE("provider_id","operation")
);
--> statement-breakpoint
CREATE TABLE "sandbox_script" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"content_hash" text NOT NULL,
	"compiled_code" text NOT NULL,
	"compiled_format" smallint DEFAULT 1 NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plugin_id" text,
	"provider_id" text,
	"id" text PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_script_plugin_id_content_hash_unique" UNIQUE("plugin_id","slug","content_hash")
);
--> statement-breakpoint
CREATE TABLE "sandbox_workflow_reference" (
	"content_hash" text NOT NULL,
	"execution_id" text PRIMARY KEY,
	"plugin_id" text NOT NULL,
	"plugin_installation_id" text,
	"script_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"plugin_installation_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"data_sources" jsonb,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"renderer" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"client_renderer_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"ip_address" text,
	"user_agent" text,
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" text PRIMARY KEY,
	"signal_schema_slug" text NOT NULL,
	"origin" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"properties" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"subject_entity_id" text,
	"signal_schema_plugin_id" text
);
--> statement-breakpoint
CREATE TABLE "signal_recipient" (
	"user_id" text,
	"signal_id" text,
	CONSTRAINT "signal_recipient_pkey" PRIMARY KEY("signal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_run" (
	"record_id" text,
	"rule_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"sandbox_script_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"started_at" timestamp with time zone,
	"logs" jsonb,
	"finished_at" timestamp with time zone,
	"timing" jsonb,
	"script_updated_at" timestamp with time zone,
	"rule_metadata" jsonb,
	"sandbox_error" jsonb,
	"skip_reason" jsonb,
	"returned_value" jsonb,
	"operation" text NOT NULL,
	"source_kind" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signal_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"execution_user_id" text,
	"occurrence_id" text NOT NULL,
	CONSTRAINT "subscription_run_operation_check" CHECK ("operation" in ('create', 'update', 'delete', 'signal')),
	CONSTRAINT "subscription_run_source_kind_check" CHECK ("source_kind" in ('entity', 'event', 'relationship', 'signal')),
	CONSTRAINT "subscription_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "subscription_run_source_check" CHECK ((("source_kind" = 'signal' and "operation" = 'signal' and "signal_id" is not null and "record_id" is null) or ("source_kind" <> 'signal' and "operation" <> 'signal' and "signal_id" is null and "record_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"verified" boolean NOT NULL,
	"backup_codes" text NOT NULL,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"image" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY,
	"two_factor_enabled" boolean,
	"email" text NOT NULL UNIQUE,
	"disabled_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"bootstrap_completed_at" timestamp with time zone,
	"preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_lifecycle_operation" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"reset_result" jsonb,
	"finished_at" timestamp with time zone,
	"workflow_attempt" integer DEFAULT 0 NOT NULL,
	"access_revoked_at" timestamp with time zone,
	"failure" jsonb,
	"kind" text NOT NULL,
	"access_revocation_started_at" timestamp with time zone,
	"database_cleanup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"value" text NOT NULL,
	"identifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE INDEX "automation_occurrence_user_id_idx" ON "automation_occurrence" ("user_id");--> statement-breakpoint
CREATE INDEX "automation_occurrence_signal_id_idx" ON "automation_occurrence" ("signal_id");--> statement-breakpoint
CREATE INDEX "backup_run_user_id_idx" ON "backup_run" ("user_id");--> statement-breakpoint
CREATE INDEX "backup_run_status_idx" ON "backup_run" ("status");--> statement-breakpoint
CREATE INDEX "backup_run_expires_at_idx" ON "backup_run" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_run_user_active_unique" ON "backup_run" ("user_id") WHERE "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "client_page_build_user_id_idx" ON "client_page_build" ("user_id");--> statement-breakpoint
CREATE INDEX "client_renderer_user_id_idx" ON "client_renderer" ("user_id");--> statement-breakpoint
CREATE INDEX "entity_user_id_idx" ON "entity" ("user_id");--> statement-breakpoint
CREATE INDEX "entity_external_id_idx" ON "entity" ("external_id");--> statement-breakpoint
CREATE INDEX "entity_provider_id_idx" ON "entity" ("provider_id");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_slug_idx" ON "entity" ("entity_schema_slug");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_plugin_id_idx" ON "entity" ("entity_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "entity_properties_idx" ON "entity" USING gin ("properties");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_user_plugin_external_id_unique" ON "entity" ("user_id","external_id","entity_schema_slug","provider_id","entity_schema_plugin_id") WHERE "user_id" IS NOT NULL AND "external_id" IS NOT NULL AND "provider_id" IS NOT NULL AND "entity_schema_plugin_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_user_kernel_external_id_unique" ON "entity" ("user_id","external_id","entity_schema_slug","provider_id") WHERE "user_id" IS NOT NULL AND "external_id" IS NOT NULL AND "provider_id" IS NOT NULL AND "entity_schema_plugin_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_plugin_external_id_unique" ON "entity" ("external_id","entity_schema_slug","provider_id","entity_schema_plugin_id") WHERE "user_id" IS NULL AND "provider_id" IS NOT NULL AND "entity_schema_plugin_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_kernel_external_id_unique" ON "entity" ("external_id","entity_schema_slug","provider_id") WHERE "user_id" IS NULL AND "provider_id" IS NOT NULL AND "entity_schema_plugin_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_plugin_no_provider_external_id_unique" ON "entity" ("external_id","entity_schema_slug","entity_schema_plugin_id") WHERE "user_id" IS NULL AND "provider_id" IS NULL AND "entity_schema_plugin_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_kernel_no_provider_external_id_unique" ON "entity" ("external_id","entity_schema_slug") WHERE "user_id" IS NULL AND "provider_id" IS NULL AND "entity_schema_plugin_id" IS NULL;--> statement-breakpoint
CREATE INDEX "entity_translation_entity_id_idx" ON "entity_translation" ("entity_id");--> statement-breakpoint
CREATE INDEX "event_user_id_idx" ON "event" ("user_id");--> statement-breakpoint
CREATE INDEX "event_entity_id_idx" ON "event" ("entity_id");--> statement-breakpoint
CREATE INDEX "event_event_schema_slug_idx" ON "event" ("event_schema_slug");--> statement-breakpoint
CREATE INDEX "event_event_schema_plugin_id_idx" ON "event" ("event_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_properties_idx" ON "event" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "event_user_entity_schema_order_idx" ON "event" ("user_id","entity_id","event_schema_slug","occurred_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_user_session_order_idx" ON "event" ("user_id","session_entity_id","occurred_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_user_id_created_at_idx" ON "import_run" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_integration_id_created_at_idx" ON "import_run" ("integration_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_plugin_installation_id_idx" ON "import_run" ("plugin_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_run_integration_active_unique" ON "import_run" ("integration_id") WHERE "integration_lot" = 'yank' and "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "import_run_failure_run_id_created_at_idx" ON "import_run_failure" ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_user_id_created_at_idx" ON "integration" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_user_id_provider_idx" ON "integration" ("user_id","provider");--> statement-breakpoint
CREATE INDEX "integration_plugin_installation_id_idx" ON "integration" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "integration_lot_is_disabled_idx" ON "integration" ("lot","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_provider_is_disabled_idx" ON "integration" ("provider","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_auto_disable_claim_integration_id_idx" ON "integration_auto_disable_claim" ("integration_id");--> statement-breakpoint
CREATE INDEX "managed_asset_owner_user_id_idx" ON "managed_asset" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "migration_report_detail_report_seq_seq_idx" ON "migration_report_detail" ("report_seq","seq");--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_created_at_idx" ON "notification_channel" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_is_disabled_idx" ON "notification_channel" ("user_id","is_disabled");--> statement-breakpoint
CREATE INDEX "notification_subscription_state_user_id_idx" ON "notification_subscription_state" ("user_id");--> statement-breakpoint
CREATE INDEX "notification_subscription_state_signal_schema_plugin_id_idx" ON "notification_subscription_state" ("signal_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_clientId_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_sessionId_idx" ON "oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_userId_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refreshId_idx" ON "oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorizationCodeId_idx" ON "oauth_access_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauth_client_userId_idx" ON "oauth_client" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_clientId_idx" ON "oauth_client_resource" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resourceId_idx" ON "oauth_client_resource" ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_resource_clientId_resourceId_uidx" ON "oauth_client_resource" ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_clientId_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_userId_idx" ON "oauth_consent" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_clientId_idx" ON "oauth_refresh_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_sessionId_idx" ON "oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_userId_idx" ON "oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorizationCodeId_idx" ON "oauth_refresh_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "plugin_owner_id_idx" ON "plugin" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_system_slug_unique" ON "plugin" ("slug") WHERE "scope" = 'system';--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_owner_slug_unique" ON "plugin" ("owner_id","slug") WHERE "scope" = 'user';--> statement-breakpoint
CREATE INDEX "plugin_installation_user_id_idx" ON "plugin_installation" ("user_id");--> statement-breakpoint
CREATE INDEX "plugin_installation_plugin_id_idx" ON "plugin_installation" ("plugin_id");--> statement-breakpoint
CREATE INDEX "relationship_schema_slug_idx" ON "relationship" ("relationship_schema_slug");--> statement-breakpoint
CREATE INDEX "relationship_schema_plugin_id_idx" ON "relationship" ("relationship_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "relationship_source_entity_id_idx" ON "relationship" ("source_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_target_entity_id_idx" ON "relationship" ("target_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_properties_idx" ON "relationship" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "sandbox_provider_plugin_id_idx" ON "sandbox_provider" ("plugin_id");--> statement-breakpoint
CREATE INDEX "sandbox_provider_root_entity_schema_slug_idx" ON "sandbox_provider" ("root_entity_schema_slug");--> statement-breakpoint
CREATE INDEX "sandbox_provider_operation_provider_id_idx" ON "sandbox_provider_operation" ("provider_id");--> statement-breakpoint
CREATE INDEX "sandbox_provider_operation_script_id_idx" ON "sandbox_provider_operation" ("script_id");--> statement-breakpoint
CREATE INDEX "sandbox_script_provider_id_idx" ON "sandbox_script" ("provider_id");--> statement-breakpoint
CREATE INDEX "sandbox_script_plugin_id_idx" ON "sandbox_script" ("plugin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_script_kernel_slug_content_hash_unique" ON "sandbox_script" ("slug","content_hash") WHERE "plugin_id" is null;--> statement-breakpoint
CREATE INDEX "sandbox_workflow_reference_plugin_id_idx" ON "sandbox_workflow_reference" ("plugin_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_reference_script_id_idx" ON "sandbox_workflow_reference" ("script_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_reference_plugin_installation_id_idx" ON "sandbox_workflow_reference" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "saved_view_user_id_idx" ON "saved_view" ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_plugin_installation_id_idx" ON "saved_view" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "saved_view_client_renderer_id_idx" ON "saved_view" ("client_renderer_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "signal_actor_user_id_idx" ON "signal" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "signal_signal_schema_slug_idx" ON "signal" ("signal_schema_slug");--> statement-breakpoint
CREATE INDEX "signal_signal_schema_plugin_id_idx" ON "signal" ("signal_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "signal_subject_entity_id_idx" ON "signal" ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "signal_recipient_user_id_idx" ON "signal_recipient" ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_run_execution_user_id_idx" ON "subscription_run" ("execution_user_id");--> statement-breakpoint
CREATE INDEX "subscription_run_rule_id_idx" ON "subscription_run" ("rule_id");--> statement-breakpoint
CREATE INDEX "subscription_run_occurrence_id_idx" ON "subscription_run" ("occurrence_id");--> statement-breakpoint
CREATE INDEX "subscription_run_signal_id_idx" ON "subscription_run" ("signal_id");--> statement-breakpoint
CREATE INDEX "user_lifecycle_operation_user_id_idx" ON "user_lifecycle_operation" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lifecycle_operation_user_active_unique" ON "user_lifecycle_operation" ("user_id") WHERE "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_occurrence" ADD CONSTRAINT "automation_occurrence_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_occurrence" ADD CONSTRAINT "automation_occurrence_signal_id_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signal"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_page_build" ADD CONSTRAINT "client_page_build_renderer_id_client_renderer_id_fkey" FOREIGN KEY ("renderer_id") REFERENCES "client_renderer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_page_build" ADD CONSTRAINT "client_page_build_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_page_build" ADD CONSTRAINT "client_page_build_h5bSY8fiMNIQ_fkey" FOREIGN KEY ("artifact_hash") REFERENCES "plugin_client_artifact"("hash") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "client_renderer" ADD CONSTRAINT "client_renderer_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_renderer" ADD CONSTRAINT "client_renderer_2daUrxvoruES_fkey" FOREIGN KEY ("published_artifact_hash") REFERENCES "plugin_client_artifact"("hash") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_entity_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("entity_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_translation" ADD CONSTRAINT "entity_translation_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fkey" FOREIGN KEY ("session_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("event_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_integration_id_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_plugin_installation_id_plugin_installation_id_fkey" FOREIGN KEY ("plugin_installation_id") REFERENCES "plugin_installation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "import_run_failure" ADD CONSTRAINT "import_run_failure_run_id_import_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_Q1xPD5Jsz3qI_fkey" FOREIGN KEY ("plugin_installation_id","user_id") REFERENCES "plugin_installation"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_auto_disable_claim" ADD CONSTRAINT "integration_auto_disable_claim_TMe6DSsXf5GU_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managed_asset" ADD CONSTRAINT "managed_asset_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "migration_report_detail" ADD CONSTRAINT "migration_report_detail_report_seq_migration_report_seq_fkey" FOREIGN KEY ("report_seq") REFERENCES "migration_report"("seq") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_subscription_state" ADD CONSTRAINT "notification_subscription_state_6cYqs9dCUQns_fkey" FOREIGN KEY ("signal_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "notification_subscription_state" ADD CONSTRAINT "notification_subscription_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_dn2L1gs9Dolm_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_client_artifact_file" ADD CONSTRAINT "plugin_client_artifact_file_vYqlZNnp2DwH_fkey" FOREIGN KEY ("artifact_hash") REFERENCES "plugin_client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "plugin_installation" ADD CONSTRAINT "plugin_installation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_installation" ADD CONSTRAINT "plugin_installation_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_source_file" ADD CONSTRAINT "plugin_source_file_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_relationship_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("relationship_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_provider" ADD CONSTRAINT "sandbox_provider_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_provider_operation" ADD CONSTRAINT "sandbox_provider_operation_script_id_sandbox_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "sandbox_script"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sandbox_provider_operation" ADD CONSTRAINT "sandbox_provider_operation_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_reference" ADD CONSTRAINT "sandbox_workflow_reference_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_reference" ADD CONSTRAINT "sandbox_workflow_reference_NZbiTLiwtL2v_fkey" FOREIGN KEY ("plugin_installation_id") REFERENCES "plugin_installation"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_reference" ADD CONSTRAINT "sandbox_workflow_reference_script_id_sandbox_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "sandbox_script"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_client_renderer_id_client_renderer_id_fkey" FOREIGN KEY ("client_renderer_id") REFERENCES "client_renderer"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_plugin_installation_owner_fk" FOREIGN KEY ("plugin_installation_id","user_id") REFERENCES "plugin_installation"("id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_subject_entity_id_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_signal_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("signal_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_signal_id_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signal"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_signal_id_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signal"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_execution_user_id_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD CONSTRAINT "subscription_run_occurrence_id_automation_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "automation_occurrence"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
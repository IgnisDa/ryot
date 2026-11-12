CREATE TABLE "account" (
	"scope" text,
	"id_token" text,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token_expires_at" timestamp(3) with time zone,
	"refresh_token_expires_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_script_execution" (
	"id" text PRIMARY KEY,
	"source" text NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"result" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"principal" jsonb,
	"user_id" text NOT NULL,
	"journal" jsonb DEFAULT '[]' NOT NULL
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
	"expires_at" timestamp(3) with time zone,
	"refill_interval" integer,
	"last_request" timestamp(3) with time zone,
	"last_refill_at" timestamp(3) with time zone,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"config_id" text DEFAULT 'default' NOT NULL,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"reference_id" text NOT NULL
);
--> statement-breakpoint
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
	"text" text NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"request_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"failure" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	CONSTRAINT "assistant_turn_conversation_id_request_id_unique" UNIQUE("conversation_id","request_id"),
	CONSTRAINT "assistant_turn_id_conversation_id_user_id_unique" UNIQUE("id","conversation_id","user_id"),
	CONSTRAINT "assistant_turn_status" CHECK ("status" in ('queued', 'running', 'awaiting-approval', 'completed', 'failed', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY,
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	"hook_slug" text NOT NULL,
	"hook_name" text NOT NULL,
	"script_slug" text NOT NULL,
	"next_attempt_at" timestamp(3) with time zone,
	"script_content_hash" text NOT NULL,
	"history_payload" jsonb,
	"artifacts_expire_at" timestamp(3) with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"stage" text NOT NULL,
	"skip_reason" jsonb,
	"retry_policy" jsonb,
	"sandbox_script_id" text,
	"history_payload_truncated" boolean DEFAULT false NOT NULL,
	"delivery" text NOT NULL,
	"plugin_id" text,
	"execution_user_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"plugin_revision_id" text,
	"trigger_id" text NOT NULL,
	"plugin_config_revision_id" text,
	CONSTRAINT "automation_run_hook_recipient_unique" UNIQUE NULLS NOT DISTINCT("trigger_id","plugin_id","hook_slug","execution_user_id"),
	CONSTRAINT "automation_run_owner_check" CHECK (("plugin_id" is null and "plugin_revision_id" is null and "plugin_config_revision_id" is null) or ("plugin_id" is not null and "plugin_revision_id" is not null and "plugin_config_revision_id" is not null)),
	CONSTRAINT "automation_run_stage_check" CHECK (("stage" = 'before' and "delivery" = 'policy' and "retry_policy" is null and "next_attempt_at" is null and "attempt_count" <= 1) or ("stage" = 'after' and "delivery" in ('required', 'async') and "retry_policy" is not null)),
	CONSTRAINT "automation_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed', 'rejected', 'skipped') and "attempt_count" >= 0),
	CONSTRAINT "automation_run_live_script_check" CHECK ("status" not in ('queued', 'running') or "sandbox_script_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "automation_run_attempt" (
	"id" text PRIMARY KEY,
	"finished_at" timestamp(3) with time zone,
	"execution_id" text NOT NULL CONSTRAINT "automation_run_attempt_execution_unique" UNIQUE,
	"retryable" boolean NOT NULL,
	"artifacts_pruned_at" timestamp(3) with time zone,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp(3) with time zone NOT NULL,
	"logs" jsonb,
	"error" jsonb,
	"timing" jsonb,
	"history_logs" jsonb,
	"history_error" jsonb,
	"history_artifacts_truncated" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"failure_kind" text,
	"returned_value" jsonb,
	"run_id" text NOT NULL,
	CONSTRAINT "automation_run_attempt_number_unique" UNIQUE("run_id","attempt_number"),
	CONSTRAINT "automation_run_attempt_state_check" CHECK ("attempt_number" > 0 and (("status" = 'running' and "finished_at" is null) or ("status" in ('succeeded', 'failed') and "finished_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "automation_trigger" (
	"initiator_id" text,
	"parent_run_id" text,
	"import_run_id" text,
	"integration_id" text,
	"parent_trigger_id" text,
	"id" text PRIMARY KEY,
	"depth" integer NOT NULL,
	"provider_execution_id" text,
	"execution_id" text NOT NULL,
	"payload_pruned_at" timestamp(3) with time zone,
	"root_execution_id" text NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"payload" jsonb,
	"blocked_reason" jsonb,
	"lane" text NOT NULL,
	"scope_user_id" text,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"operation" text NOT NULL,
	"resource_kind" text NOT NULL,
	"initiator_kind" text NOT NULL,
	CONSTRAINT "automation_trigger_kind_check" CHECK (("category" in ('request', 'change') and "resource_kind" in ('entity', 'event', 'relationship') and "operation" in ('create', 'update', 'delete', 'batch')) or ("category" = 'change' and "resource_kind" = 'provider-entity-import' and "operation" = 'complete') or ("category" = 'signal' and "resource_kind" = 'signal' and "operation" = 'emit')),
	CONSTRAINT "automation_trigger_causation_check" CHECK ("depth" >= 0 and "lane" in ('interactive', 'background') and "initiator_kind" in ('user', 'integration', 'system') and "source" in ('api', 'import', 'integration', 'bootstrap', 'provider-refresh', 'scheduler', 'automation') and ("source" <> 'automation' or ("parent_run_id" is not null and "parent_trigger_id" is not null and "depth" > 0))),
	CONSTRAINT "automation_trigger_payload_check" CHECK (("payload" is null) = ("payload_pruned_at" is not null)),
	CONSTRAINT "automation_trigger_parent_check" CHECK ("parent_run_id" is null or "parent_trigger_id" is not null),
	CONSTRAINT "automation_trigger_initiator_check" CHECK ("initiator_kind" = 'system' or "initiator_id" is not null),
	CONSTRAINT "automation_trigger_payload_kind_check" CHECK ("payload" is null or (jsonb_typeof("payload") = 'object' and ("payload"->>'category') is not distinct from "category" and ("payload"->>'resource') is not distinct from "resource_kind" and ("payload"->>'operation') is not distinct from "operation"))
);
--> statement-breakpoint
CREATE TABLE "automation_trigger_recipient" (
	"user_id" text,
	"trigger_id" text,
	CONSTRAINT "automation_trigger_recipient_pkey" PRIMARY KEY("trigger_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "backup_run" (
	"artifact_key" text,
	"expires_at" timestamp(3) with time zone,
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	"progress" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"kind" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"artifact_provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "backup_staging_record" (
	"id" text,
	"destination_id" text,
	"section" text NOT NULL,
	"namespace" text,
	"value" jsonb NOT NULL,
	"inserted" boolean DEFAULT false NOT NULL,
	"run_id" text,
	CONSTRAINT "backup_staging_record_pkey" PRIMARY KEY("run_id","namespace","id")
);
--> statement-breakpoint
CREATE TABLE "backup_staging_reference" (
	"source_id" text,
	"target_id" text,
	"source_namespace" text,
	"target_namespace" text,
	"run_id" text,
	CONSTRAINT "backup_staging_reference_pkey" PRIMARY KEY("run_id","source_namespace","source_id","target_namespace","target_id")
);
--> statement-breakpoint
CREATE TABLE "backup_staging_run" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"backup_run_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_source_override" (
	"slug" text NOT NULL,
	"plugin_id" text NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "calendar_source_override_user_plugin_slug_unique" UNIQUE("user_id","plugin_id","slug")
);
--> statement-breakpoint
CREATE TABLE "client_artifact" (
	"page_declaration_hash" text,
	"format" smallint NOT NULL,
	"client_declaration_hash" text,
	"api_version" smallint NOT NULL,
	"hash" text PRIMARY KEY,
	"bridge_version" smallint NOT NULL,
	"compiler_version" smallint NOT NULL,
	"package_id" text,
	"imports" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "client_artifact_hash_package_unique" UNIQUE("hash","package_id"),
	CONSTRAINT "client_artifact_package_declaration_check" CHECK (("package_id" is null) = ("client_declaration_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "client_artifact_file" (
	"name" text,
	"contents" bytea NOT NULL,
	"content_type" text NOT NULL,
	"artifact_hash" text,
	CONSTRAINT "client_artifact_file_pkey" PRIMARY KEY("artifact_hash","name")
);
--> statement-breakpoint
CREATE TABLE "client_page_composition" (
	"composition_key" text PRIMARY KEY,
	"composition_hash" text NOT NULL UNIQUE,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"identity" jsonb NOT NULL,
	"manifest" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "definition_calendar_source" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"art" text,
	"done" text,
	"caption" text,
	"icon" text NOT NULL,
	"start_at" text NOT NULL,
	"query" jsonb NOT NULL,
	"subject" jsonb NOT NULL,
	"precision" text NOT NULL,
	"plugin_revision_id" text NOT NULL,
	CONSTRAINT "definition_calendar_source_revision_slug_unique" UNIQUE("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_entity_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"icon" text NOT NULL,
	"occurs_at_property" text,
	"refresh_interval_days" integer,
	"fold" jsonb,
	"browse" jsonb,
	"editor" jsonb,
	"merge_identity_properties" text[] NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"user_state" jsonb,
	"plugin_revision_id" text,
	CONSTRAINT "definition_entity_schema_revision_slug_unique" UNIQUE NULLS NOT DISTINCT("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_event_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"event_group" jsonb,
	"projection" jsonb,
	"properties_schema" jsonb NOT NULL,
	"entity_schema_id" text NOT NULL,
	CONSTRAINT "definition_event_schema_entity_slug_unique" UNIQUE("entity_schema_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_import_source" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"workflow_script_slug" text,
	"description" text NOT NULL,
	"workflow_slug" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"required_plugin_config_keys" text[] NOT NULL,
	"plan" jsonb,
	"export_help" jsonb,
	"plugin_revision_id" text NOT NULL,
	CONSTRAINT "definition_import_source_revision_slug_unique" UNIQUE("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_integration_provider" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"script_slug" text,
	"description" text NOT NULL,
	"plan" jsonb,
	"requires_pro_key" boolean NOT NULL,
	"settings_schema" jsonb NOT NULL,
	"supports_ownership_sync" boolean DEFAULT false NOT NULL,
	"lot" text NOT NULL,
	"plugin_revision_id" text NOT NULL,
	CONSTRAINT "definition_integration_provider_revision_slug_unique" UNIQUE("plugin_revision_id","slug"),
	CONSTRAINT "definition_integration_provider_script_check" CHECK (("lot" = 'push') = ("script_slug" is null))
);
--> statement-breakpoint
CREATE TABLE "definition_provider" (
	"slug" text,
	"position" integer NOT NULL,
	"root_entity_schema_slug" text NOT NULL,
	"plugin_revision_id" text,
	CONSTRAINT "definition_provider_pkey" PRIMARY KEY("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_provider_operation" (
	"operation" text,
	"script_slug" text NOT NULL,
	"provider_slug" text,
	"plugin_revision_id" text,
	CONSTRAINT "definition_provider_operation_pkey" PRIMARY KEY("plugin_revision_id","provider_slug","operation")
);
--> statement-breakpoint
CREATE TABLE "definition_relationship_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"source_entity_schema_slug" text,
	"target_entity_schema_slug" text,
	"projection" jsonb,
	"properties_schema" jsonb NOT NULL,
	"retention" text,
	"user_write_policy" text,
	"plugin_revision_id" text,
	CONSTRAINT "definition_relationship_schema_revision_slug_unique" UNIQUE NULLS NOT DISTINCT("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_saved_view" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"sort" text,
	"icon" text NOT NULL,
	"sort_order" integer NOT NULL,
	"filter" jsonb,
	"data_sources" jsonb,
	"settings" jsonb NOT NULL,
	"renderer" jsonb NOT NULL,
	"arguments" jsonb DEFAULT '{}' NOT NULL,
	"plugin_revision_id" text,
	CONSTRAINT "definition_saved_view_revision_slug_unique" UNIQUE NULLS NOT DISTINCT("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_signal_schedule" (
	"delay_days" integer,
	"slug" text NOT NULL,
	"due_at" text NOT NULL,
	"signal" text NOT NULL,
	"occurrence" text NOT NULL,
	"position" integer NOT NULL,
	"requires_pro_key" boolean NOT NULL,
	"query" jsonb NOT NULL,
	"subject" jsonb NOT NULL,
	"precision" text NOT NULL,
	"properties" jsonb NOT NULL,
	"freshness" jsonb,
	"id" text PRIMARY KEY,
	"plugin_revision_id" text NOT NULL,
	CONSTRAINT "definition_signal_schedule_revision_slug_unique" UNIQUE("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "definition_signal_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"id" text PRIMARY KEY,
	"notification_hook_slug" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"audience_policy" jsonb NOT NULL,
	"catalog_state" text NOT NULL,
	"plugin_revision_id" text,
	CONSTRAINT "definition_signal_schema_revision_slug_unique" UNIQUE NULLS NOT DISTINCT("plugin_revision_id","slug")
);
--> statement-breakpoint
CREATE TABLE "derived_value" (
	"target_id" text,
	"plugin_revision_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"kind" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"user_id" text,
	"plugin_id" text NOT NULL,
	"subject_entity_id" text NOT NULL,
	CONSTRAINT "derived_value_pkey" PRIMARY KEY("user_id","kind","target_id"),
	CONSTRAINT "derived_value_kind_check" CHECK ("kind" in ('subject', 'event', 'relationship', 'absorbed')),
	CONSTRAINT "derived_value_status_check" CHECK ("status" in ('ready', 'pending', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"external_id" text,
	"name" text NOT NULL,
	"occurs_at" timestamp(3) with time zone,
	"populated_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"related_populated_at" timestamp(3) with time zone,
	"entity_schema_slug" text NOT NULL,
	"related_population_generation" text,
	"related_population_started_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"content_generation" integer DEFAULT 1 NOT NULL,
	"collection_order_revision" integer DEFAULT 0 NOT NULL,
	"user_id" text,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"provider_id" text,
	"entity_schema_plugin_id" text,
	"check_after" timestamp(3) with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "entity_enrichment_request" (
	"retry_of" text,
	"language" text,
	"joined_to" text,
	"input_hash" text,
	"population_pin" text,
	"id" text PRIMARY KEY,
	"plugin_id" text NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"sequence" serial,
	"base_checked_at" timestamp(3) with time zone,
	"external_id" text NOT NULL,
	"entity_schema_slug" text NOT NULL,
	"source_content_generation" integer,
	"level" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"failure_kind" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"population_mode" text,
	"operation" text NOT NULL,
	"entity_id" text,
	"scope_user_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"requester_user_id" text,
	"provider_id" text NOT NULL,
	CONSTRAINT "entity_enrichment_request_attempt_check" CHECK ("attempt" between 0 and 3),
	CONSTRAINT "entity_enrichment_request_state_check" CHECK ("state" in ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "entity_enrichment_request_operation_check" CHECK (("operation" = 'population' and "level" in ('base', 'full') and "language" is null) or ("operation" = 'translation' and "level" is null and "language" is not null))
);
--> statement-breakpoint
CREATE TABLE "entity_schema_refresh_override" (
	"slug" text,
	"plugin_id" text,
	"refresh_interval_days" integer NOT NULL,
	CONSTRAINT "entity_schema_refresh_override_pkey" PRIMARY KEY("plugin_id","slug")
);
--> statement-breakpoint
CREATE TABLE "entity_translation" (
	"name" text,
	"language" text,
	"populated_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"source_content_generation" integer NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"properties" jsonb,
	"entity_id" text,
	CONSTRAINT "entity_translation_pkey" PRIMARY KEY("entity_id","language")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"order_key" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"order_created_at" timestamp(3) with time zone,
	"event_schema_slug" text NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"session_entity_id" text,
	"event_schema_plugin_id" text,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "event_reference" (
	"property" text,
	"referenced_event_id" text NOT NULL,
	"referencing_event_id" text,
	CONSTRAINT "event_reference_pkey" PRIMARY KEY("referencing_event_id","property")
);
--> statement-breakpoint
CREATE TABLE "event_scope" (
	"id" text PRIMARY KEY,
	"revision" integer DEFAULT 0 NOT NULL,
	"event_schema_plugin_id" text,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"key" text,
	"fingerprint" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	CONSTRAINT "idempotency_key_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "import_activity" (
	"data" jsonb NOT NULL,
	"parent_id" text GENERATED ALWAYS AS (data->>'parentId') STORED,
	"id" text GENERATED ALWAYS AS (data->>'id') STORED,
	"run_id" text,
	CONSTRAINT "import_activity_pkey" PRIMARY KEY("run_id","id"),
	CONSTRAINT "import_activity_parent_check" CHECK ("id" is distinct from "parent_id")
);
--> statement-breakpoint
CREATE TABLE "import_issue" (
	"data" jsonb NOT NULL,
	"id" text GENERATED ALWAYS AS (data->>'id') STORED,
	"run_id" text,
	CONSTRAINT "import_issue_pkey" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_item" (
	"id" text,
	"recovery_bytes" text,
	"operation_ids" text[],
	"result" jsonb,
	"data" jsonb NOT NULL,
	"released" boolean DEFAULT false NOT NULL,
	"retiring" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"write_started" boolean DEFAULT false NOT NULL,
	"capture_released" boolean DEFAULT false NOT NULL,
	"capture_id" text GENERATED ALWAYS AS (data->>'captureId') STORED,
	"ordinal" integer GENERATED ALWAYS AS ((data->>'ordinal')::integer) STORED,
	"kind" text,
	"run_id" text,
	"phase" text GENERATED ALWAYS AS (data->>'phase') STORED,
	CONSTRAINT "import_item_pkey" PRIMARY KEY("run_id","kind","id"),
	CONSTRAINT "import_item_kind_check" CHECK ("kind" in ('payload', 'batch', 'outcome', 'result')),
	CONSTRAINT "import_item_ordinal_check" CHECK ("ordinal" >= 0),
	CONSTRAINT "import_item_phase_check" CHECK ("kind" <> 'payload' or "phase" in ('collection', 'application')),
	CONSTRAINT "import_item_batch_check" CHECK ("kind" <> 'batch' or ("ordinal" is not null and "capture_id" is not null and "operation_ids" is not null)),
	CONSTRAINT "import_item_staging_check" CHECK ("kind" <> 'payload' or ("ordinal" is null) = (data->>'stagingExecutionId' is not null)),
	CONSTRAINT "import_item_recovery_check" CHECK ("recovery_bytes" is null or length("recovery_bytes") <= 5592408)
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	"block_deadline" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"auto_disabled_at" timestamp(3) with time zone,
	"plan" jsonb,
	"pins" jsonb,
	"integration_lot" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"collection_sealed" boolean DEFAULT false NOT NULL,
	"expiry_reason" text,
	"failure_reason" jsonb,
	"prepared_release" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_summary" jsonb DEFAULT '{}' NOT NULL,
	"integration_id" text,
	"user_id" text NOT NULL,
	"block_reasons" jsonb DEFAULT '[]' NOT NULL,
	"id" text PRIMARY KEY,
	"plugin_installation_id" text,
	CONSTRAINT "import_run_owner_unique" UNIQUE("id","user_id"),
	CONSTRAINT "import_run_prepared_release_check" CHECK ("prepared_release" is null or ("pins" is not null and ("plan" is null or "plan" = "prepared_release"->'plan'))),
	CONSTRAINT "import_run_block_check" CHECK ("status" <> 'blocked' or ("integration_lot" = 'sink' and "block_deadline" = "created_at" + interval '168 hours')),
	CONSTRAINT "import_run_expiry_check" CHECK (("status" = 'expired') = ("expiry_reason" is not null)),
	CONSTRAINT "import_run_status_check" CHECK ("status" in ('pending', 'blocked', 'expired', 'running', 'cancelling', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "import_run_integration_lot_check" CHECK (("integration_id" is null) = ("integration_lot" is null))
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"name" text,
	"webhook_token" text,
	"plugin_installation_id" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"last_finished_at" timestamp(3) with time zone,
	"retiring" boolean DEFAULT false NOT NULL,
	"lot" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"sync_ownership" boolean DEFAULT false NOT NULL,
	"minimum_progress" numeric DEFAULT '2' NOT NULL,
	"maximum_progress" numeric DEFAULT '95' NOT NULL,
	"provider" text NOT NULL,
	"extra_settings" jsonb NOT NULL,
	"provider_specifics" jsonb NOT NULL,
	"client_provider_specifics" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "integration_oauth_owner_unique" UNIQUE("id","user_id","plugin_installation_id","provider"),
	CONSTRAINT "integration_run_owner_unique" UNIQUE("id","user_id"),
	CONSTRAINT "integration_owner_check" CHECK (("plugin_installation_id" is null and "provider" = 'data-json' and "lot" = 'sink') or ("plugin_installation_id" is not null and "provider" <> 'data-json')),
	CONSTRAINT "integration_webhook_token_lot_check" CHECK (("lot" = 'sink') = ("webhook_token" is not null))
);
--> statement-breakpoint
CREATE TABLE "job" (
	"key" text,
	"error" text,
	"kind" text NOT NULL,
	"id" text PRIMARY KEY,
	"attempts" integer NOT NULL,
	"priority" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"run_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"payload" json NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	CONSTRAINT "job_status_check" CHECK ("status" in ('queued', 'running', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"alg" text,
	"crv" text,
	"id" text PRIMARY KEY,
	"expires_at" timestamp(3) with time zone,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel_script" (
	"slug" text PRIMARY KEY,
	"script_id" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "managed_asset" (
	"key" text,
	"sha256" text NOT NULL,
	"retired_at" timestamp(3) with time zone,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"provider" text,
	"check_after" timestamp(3) with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"owner_user_id" text NOT NULL,
	CONSTRAINT "managed_asset_pkey" PRIMARY KEY("provider","key")
);
--> statement-breakpoint
CREATE TABLE "migration_report" (
	"code" text,
	"count" integer,
	"phase" text NOT NULL,
	"message" text NOT NULL,
	"seq" serial PRIMARY KEY,
	"elapsed_seconds" double precision,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "migration_report_level_check" CHECK ("level" in ('info', 'warning')),
	CONSTRAINT "migration_report_warning_code_check" CHECK ("level" <> 'warning' or "code" is not null)
);
--> statement-breakpoint
CREATE TABLE "migration_report_detail" (
	"seq" serial PRIMARY KEY,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"detail" jsonb NOT NULL,
	"report_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"source_run_id" text,
	"id" text PRIMARY KEY,
	"settled_at" timestamp(3) with time zone,
	"source_key" text NOT NULL,
	"input_digest" text NOT NULL,
	"outcome" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"state" text NOT NULL,
	"request" jsonb NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "notification_state_check" CHECK (("state" = 'admitted' and "outcome" is null and "settled_at" is null) or ("state" = 'settled' and "outcome" is not null and "outcome" in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and "settled_at" is not null)),
	CONSTRAINT "notification_reason_check" CHECK ("reason" is null or ("state" = 'settled' and "outcome" = 'not-sent' and "reason" = 'no-enabled-channels')),
	CONSTRAINT "notification_request_check" CHECK (jsonb_typeof("request") = 'object' and ("request" = '{"kind":"test"}'::jsonb or ("request" @> '{"kind":"message"}'::jsonb and "request" ? 'message' and jsonb_typeof("request"->'message') = 'string')))
);
--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"platform_specifics" jsonb NOT NULL,
	"platform" text GENERATED ALWAYS AS (platform_specifics->>'kind') STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"attempt_id" text,
	"diagnostic" text,
	"id" text PRIMARY KEY,
	"claimed_at" timestamp(3) with time zone,
	"settled_at" timestamp(3) with time zone,
	"channel_id" text NOT NULL,
	"description" text NOT NULL,
	"reason" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"notification_id" text NOT NULL,
	CONSTRAINT "notification_delivery_status_check" CHECK ("status" in ('queued', 'sending', 'accepted', 'failed', 'unknown', 'skipped')),
	CONSTRAINT "notification_delivery_attempt_check" CHECK (("attempt_id" is null and "claimed_at" is null and "status" not in ('sending', 'accepted', 'unknown')) or ("attempt_id" is not null and "claimed_at" is not null and "status" <> 'queued')),
	CONSTRAINT "notification_delivery_settlement_check" CHECK (("status" in ('queued', 'sending') and "settled_at" is null) or ("status" not in ('queued', 'sending') and "settled_at" is not null)),
	CONSTRAINT "notification_delivery_reason_check" CHECK (("status" in ('queued', 'sending', 'accepted') and "reason" is null) or ("reason" is not null and (("status" = 'failed' and "reason" in ('preparation-failed', 'provider-rejected')) or ("status" = 'unknown' and "reason" = 'delivery-unknown') or ("status" = 'skipped' and "reason" in ('server-disabled', 'channel-disabled', 'channel-deleted', 'source-cancelled')))))
);
--> statement-breakpoint
CREATE TABLE "notification_subscription" (
	"signal_schema_slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"signal_schema_plugin_id" text,
	"user_id" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "notification_subscription_user_signal_unique" UNIQUE NULLS NOT DISTINCT("user_id","signal_schema_slug","signal_schema_plugin_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"reference_id" text,
	"token" text UNIQUE,
	"revoked" timestamp(3) with time zone,
	"id" text PRIMARY KEY,
	"resources" text[],
	"authorization_code_id" text,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"requested_user_info_claims" text[],
	"confirmation" jsonb,
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
	"created_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone,
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
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"metadata" jsonb,
	"client_credentials_scopes" text[] DEFAULT '{}'::text[],
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY,
	"created_at" timestamp(3) with time zone,
	"metadata" jsonb,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_connection" (
	"integration_id" text,
	"id" text PRIMARY KEY,
	"field" text NOT NULL,
	"expires_at" timestamp(3) with time zone,
	"state_hash" text NOT NULL CONSTRAINT "oauth_connection_state_hash_unique" UNIQUE,
	"completion_secret_hash" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"token_url_origin" text NOT NULL,
	"refresh_lease_until" timestamp(3) with time zone,
	"oauth_provider_slug" text NOT NULL,
	"access_token_expires_at" timestamp(3) with time zone,
	"plugin_installation_id" text NOT NULL,
	"code" jsonb,
	"integration_provider_slug" text NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"access_token" jsonb,
	"code_verifier" jsonb,
	"refresh_token" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"client" jsonb NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "oauth_connection_integration_field_unique" UNIQUE("integration_id","field"),
	CONSTRAINT "oauth_connection_status_check" CHECK ("status" in ('pending', 'authorized', 'connected', 'failed', 'expired')),
	CONSTRAINT "oauth_connection_integration_status_check" CHECK ("integration_id" is null or "status" in ('connected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"reference_id" text,
	"id" text PRIMARY KEY,
	"resources" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"requested_user_info_claims" text[],
	"user_id" text,
	"client_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"reference_id" text,
	"revoked" timestamp(3) with time zone,
	"id" text PRIMARY KEY,
	"auth_time" timestamp(3) with time zone,
	"rotated_at" timestamp(3) with time zone,
	"resources" text[],
	"authorization_code_id" text,
	"rotation_replay_response" text,
	"token" text NOT NULL UNIQUE,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"rotation_replay_expires_at" timestamp(3) with time zone,
	"requested_user_info_claims" text[],
	"confirmation" jsonb,
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
	"created_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"allowed_scopes" text[],
	"disabled" boolean DEFAULT false,
	"policy_version" integer DEFAULT 1,
	"identifier" text NOT NULL UNIQUE,
	"metadata" jsonb,
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "page" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"published_revision" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"published_definition_hash" text,
	"draft_compiled_revision" integer,
	"draft_definition_hash" text NOT NULL,
	"origin" text NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"authority_revision" integer DEFAULT 1 NOT NULL,
	"published_definition" jsonb,
	"draft_definition" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"draft_artifact_hash" text,
	"published_artifact_hash" text,
	"user_id" text NOT NULL,
	CONSTRAINT "page_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "page_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "plugin" (
	"status" text NOT NULL,
	"active_revision_id" text,
	"environment_config_revision_id" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"package_id" text NOT NULL,
	"owner_user_id" text,
	"activation_id" text NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "plugin_id_package_unique" UNIQUE("id","package_id"),
	CONSTRAINT "plugin_package_id_format_check" CHECK ("package_id" ~ '^(?=[a-z0-9-]{1,64}(/|$))[a-z0-9]+(-[a-z0-9]+)*/(?=[a-z0-9-]{1,64}(/|$))[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "plugin_active_revision_check" CHECK ("status" <> 'active' or "active_revision_id" is not null),
	CONSTRAINT "plugin_environment_config_scope_check" CHECK ("owner_user_id" is null or "environment_config_revision_id" is null)
);
--> statement-breakpoint
CREATE TABLE "plugin_config_encryption_key" (
	"id" text NOT NULL,
	"key" bytea NOT NULL,
	"singleton" boolean PRIMARY KEY DEFAULT true,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_config_encryption_key_singleton_check" CHECK ("singleton" = true),
	CONSTRAINT "plugin_config_encryption_key_length_check" CHECK (octet_length("key") = 32)
);
--> statement-breakpoint
CREATE TABLE "plugin_config_revision" (
	"nonce" bytea NOT NULL,
	"encrypted_payload" bytea,
	"payload_pruned_at" timestamp(3) with time zone,
	"encryption_key_id" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"configured_keys" text[] NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY,
	"owner_user_id" text,
	"plugin_revision_id" text NOT NULL,
	"plugin_installation_id" text,
	CONSTRAINT "plugin_config_revision_id_revision_unique" UNIQUE("id","plugin_revision_id"),
	CONSTRAINT "plugin_config_revision_scope_check" CHECK ("owner_user_id" is not null or "plugin_installation_id" is null),
	CONSTRAINT "plugin_config_revision_payload_check" CHECK (("encrypted_payload" is null) = ("payload_pruned_at" is not null)),
	CONSTRAINT "plugin_config_revision_envelope_check" CHECK (octet_length("nonce") = 12 and ("encrypted_payload" is null or octet_length("encrypted_payload") >= 16))
);
--> statement-breakpoint
CREATE TABLE "plugin_installation" (
	"health_reason" text,
	"uninstalled_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"is_initialized" boolean DEFAULT false NOT NULL,
	"home_saved_view" jsonb,
	"ingestion_retiring" boolean DEFAULT false NOT NULL,
	"configured_secret_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"incompatibility_reason" text,
	"client_config" jsonb DEFAULT '{}' NOT NULL,
	"user_settings" jsonb DEFAULT '{}' NOT NULL,
	"user_id" text NOT NULL,
	"active_config_revision_id" text,
	"plugin_id" text NOT NULL,
	"id" text PRIMARY KEY,
	"health" text DEFAULT 'ready' NOT NULL,
	CONSTRAINT "plugin_installation_user_plugin_unique" UNIQUE("user_id","plugin_id"),
	CONSTRAINT "plugin_installation_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "plugin_installation_incompatibility_reason_check" CHECK ("incompatibility_reason" is null or ("incompatibility_reason" = 'package-identity-conflict' and "health" = 'incompatible'))
);
--> statement-breakpoint
CREATE TABLE "plugin_revision" (
	"name" text,
	"icon" text,
	"description" text,
	"version" text NOT NULL,
	"client_artifact_hash" text,
	"plugin_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"client" jsonb,
	"manifest" jsonb NOT NULL,
	"queries" jsonb,
	"package_id" text NOT NULL,
	"client_config_schema" jsonb NOT NULL,
	"hooks" jsonb NOT NULL,
	"crons" jsonb NOT NULL,
	"memberships" jsonb,
	"dependencies" jsonb,
	"scripts" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"workflows" jsonb NOT NULL,
	"providers" jsonb NOT NULL,
	"oauth_providers" jsonb,
	"sandbox_authority" jsonb NOT NULL,
	"operations" jsonb NOT NULL,
	"config_schema" jsonb NOT NULL,
	"signal_schemas" jsonb NOT NULL,
	"entity_schemas" jsonb NOT NULL,
	"user_bootstrap" jsonb NOT NULL,
	"user_settings_schema" jsonb,
	"http_rate_limits" jsonb NOT NULL,
	"relationship_schemas" jsonb NOT NULL,
	"integration_providers" jsonb NOT NULL,
	CONSTRAINT "plugin_revision_plugin_content_unique" UNIQUE("plugin_id","content_hash"),
	CONSTRAINT "plugin_revision_id_plugin_unique" UNIQUE("id","plugin_id"),
	CONSTRAINT "plugin_revision_manifest_sections_check" CHECK ("name" is not distinct from ("manifest" -> 'metadata' ->> 'name') and "icon" is not distinct from ("manifest" -> 'metadata' ->> 'icon') and "description" is not distinct from ("manifest" -> 'metadata' ->> 'description') and "version" is not distinct from ("manifest" -> 'metadata' ->> 'version') and "package_id" is not distinct from ("manifest" -> 'metadata' ->> 'packageId') and "client" is not distinct from ("manifest" -> 'client') and "hooks" is not distinct from ("manifest" -> 'hooks') and "crons" is not distinct from ("manifest" -> 'crons') and "scripts" is not distinct from ("manifest" -> 'scripts') and "workflows" is not distinct from ("manifest" -> 'workflows') and "providers" is not distinct from ("manifest" -> 'providers') and "oauth_providers" is not distinct from ("manifest" -> 'oauthProviders') and "operations" is not distinct from ("manifest" -> 'operations') and "config_schema" is not distinct from ("manifest" -> 'configSchema') and "signal_schemas" is not distinct from ("manifest" -> 'signalSchemas') and "entity_schemas" is not distinct from ("manifest" -> 'entitySchemas') and "user_bootstrap" is not distinct from ("manifest" -> 'userBootstrap') and "memberships" is not distinct from ("manifest" -> 'memberships') and "user_settings_schema" is not distinct from ("manifest" -> 'userSettingsSchema') and "http_rate_limits" is not distinct from ("manifest" -> 'httpRateLimits') and "relationship_schemas" is not distinct from ("manifest" -> 'relationshipSchemas') and "integration_providers" is not distinct from ("manifest" -> 'integrationProviders'))
);
--> statement-breakpoint
CREATE TABLE "provider_rate_limit" (
	"key" text PRIMARY KEY,
	"next_allowed_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"page_id" text,
	"description" text,
	"icon" text NOT NULL,
	"title" text NOT NULL,
	"revoked_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"show_owner_name" boolean NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"snapshot_artifact_hash" text,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "publication_link" (
	"label" text NOT NULL,
	"expires_at" timestamp(3) with time zone,
	"revoked_at" timestamp(3) with time zone,
	"last_exchanged_at" timestamp(3) with time zone,
	"token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"publication_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"relationship_schema_slug" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"relationship_schema_plugin_id" text,
	"id" text PRIMARY KEY,
	"source_entity_id" text NOT NULL,
	"target_entity_id" text NOT NULL,
	CONSTRAINT "relationship_identity_unique" UNIQUE NULLS NOT DISTINCT("user_id","source_entity_id","target_entity_id","relationship_schema_slug","relationship_schema_plugin_id"),
	CONSTRAINT "relationship_collection_rank_valid" CHECK ("relationship_schema_slug" <> 'member-of' or "relationship_schema_plugin_id" is not null or coalesce(("user_id" is not null and jsonb_typeof("properties" -> 'rank') = 'number' and ("properties" ->> 'rank')::numeric = trunc(("properties" ->> 'rank')::numeric) and abs(("properties" ->> 'rank')::numeric) < 4503599627370496), false))
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"message" text,
	"timezone" text,
	"trigger_id" text,
	"entity_title" text,
	"due_at" timestamp(3) with time zone,
	"replacement_id" text,
	"formatter_run_id" text,
	"id" text PRIMARY KEY,
	"removed_at" timestamp(3) with time zone,
	"settled_at" timestamp(3) with time zone,
	"reconcile_at" timestamp(3) with time zone,
	"processing_at" timestamp(3) with time zone,
	"reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"outcome" text,
	"state" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"dispatch" jsonb,
	"original_schedule" jsonb,
	"entity_id" text,
	"parent_entity_id" text,
	"user_id" text NOT NULL,
	CONSTRAINT "reminder_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "reminder_state_check" CHECK ("state" in ('needs-scheduling', 'scheduled', 'processing', 'settled', 'cancelled')),
	CONSTRAINT "reminder_schedule_check" CHECK ("state" not in ('scheduled', 'processing') or ("due_at" is not null and "timezone" is not null and "entity_id" is not null and "reconcile_at" is not null)),
	CONSTRAINT "reminder_inactive_schedule_check" CHECK ("state" <> 'needs-scheduling' or ("due_at" is null and "timezone" is null and "original_schedule" is not null)),
	CONSTRAINT "reminder_processing_check" CHECK ("state" <> 'processing' or ("processing_at" is not null and "formatter_run_id" is not null and "trigger_id" is not null and "dispatch" is not null and "reconcile_at" is not null)),
	CONSTRAINT "reminder_outcome_check" CHECK (("state" = 'settled' and "outcome" in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and "outcome" is not null and "settled_at" is not null) or ("state" <> 'settled' and "outcome" is null)),
	CONSTRAINT "reminder_content_check" CHECK (("removed_at" is null and "message" is not null and length(btrim("message")) between 1 and 4000 and "entity_title" is not null) or ("removed_at" is not null and "state" in ('settled', 'cancelled') and "message" is null and "entity_title" is null and "original_schedule" is null))
);
--> statement-breakpoint
CREATE TABLE "sandbox_journal_entry" (
	"pin" text NOT NULL,
	"body" bytea NOT NULL,
	"execution_id" text,
	"entry_index" integer,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_journal_entry_pkey" PRIMARY KEY("execution_id","entry_index")
);
--> statement-breakpoint
CREATE TABLE "sandbox_provider" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"root_entity_schema_slug" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"information" jsonb NOT NULL,
	"plugin_id" text NOT NULL,
	"id" text PRIMARY KEY,
	CONSTRAINT "sandbox_provider_plugin_id_unique" UNIQUE("plugin_id","slug")
);
--> statement-breakpoint
CREATE TABLE "sandbox_script" (
	"source" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"content_hash" text NOT NULL,
	"compiled_code" text NOT NULL,
	"compiled_format" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb NOT NULL,
	"provider_id" text,
	"plugin_revision_id" text,
	"id" text PRIMARY KEY,
	CONSTRAINT "sandbox_script_id_revision_unique" UNIQUE("id","plugin_revision_id"),
	CONSTRAINT "sandbox_script_revision_slug_unique" UNIQUE("plugin_revision_id","slug"),
	CONSTRAINT "sandbox_script_source_owner_check" CHECK (("plugin_revision_id" is null) = ("source" is not null))
);
--> statement-breakpoint
CREATE TABLE "sandbox_workflow_reference" (
	"execution_id" text PRIMARY KEY,
	"plugin_installation_id" text,
	"script_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"sort" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"plugin_installation_id" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"filter" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"data_sources" jsonb,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"renderer" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"arguments" jsonb DEFAULT '{}' NOT NULL,
	"page_id" text GENERATED ALWAYS AS (case when renderer ->> 'kind' = 'page' then renderer ->> 'pageId' end) STORED,
	CONSTRAINT "saved_view_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "saved_view_override" (
	"plugin_id" text,
	"slug" text NOT NULL,
	"sort_order" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"ip_address" text,
	"user_agent" text,
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"impersonation_expires_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"access_class" text DEFAULT 'standard' NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_schedule_delivery" (
	"trigger_id" text NOT NULL,
	"schedule_slug" text,
	"occurrence_key" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"plugin_id" text,
	CONSTRAINT "signal_schedule_delivery_pkey" PRIMARY KEY("user_id","plugin_id","schedule_slug","occurrence_key")
);
--> statement-breakpoint
CREATE TABLE "transient_value" (
	"value" text NOT NULL,
	"key" text PRIMARY KEY,
	"expires_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"locked_until" timestamp(3) with time zone,
	"verified" boolean NOT NULL,
	"backup_codes" text NOT NULL,
	"failed_verification_count" integer DEFAULT 0,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intent" (
	"id" text PRIMARY KEY,
	"metadata" text NOT NULL,
	"deadline" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"image" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY,
	"disabled_at" timestamp(3) with time zone,
	"retiring_at" timestamp(3) with time zone,
	"two_factor_enabled" boolean,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL UNIQUE,
	"bootstrap_completed_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{"language":null,"ratingScale":"hundred","reportingTimeZone":"UTC","disableIntegrations":false}' NOT NULL,
	CONSTRAINT "user_preferences_check" CHECK (
		jsonb_typeof("preferences") = 'object'
		and "preferences" ?& array['disableIntegrations', 'language', 'ratingScale', 'reportingTimeZone']
		and "preferences" - 'disableIntegrations' - 'language' - 'ratingScale' - 'reportingTimeZone' = '{}'::jsonb
		and jsonb_typeof("preferences"->'disableIntegrations') = 'boolean'
		and "preferences"->>'ratingScale' in ('hundred', 'ten', 'five', 'three-point')
		and jsonb_typeof("preferences"->'reportingTimeZone') = 'string'
		and "preferences"->>'reportingTimeZone' <> ''
		and btrim("preferences"->>'reportingTimeZone') = "preferences"->>'reportingTimeZone'
		and (
			jsonb_typeof("preferences"->'language') = 'null'
			or (jsonb_typeof("preferences"->'language') = 'string'
				and "preferences"->>'language' <> ''
				and btrim("preferences"->>'language', E' 	
') = "preferences"->>'language')
		)
	)
);
--> statement-breakpoint
CREATE TABLE "user_lifecycle_operation" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"started_at" timestamp(3) with time zone,
	"finished_at" timestamp(3) with time zone,
	"metadata" jsonb NOT NULL,
	"access_revoked_at" timestamp(3) with time zone,
	"access_revocation_started_at" timestamp(3) with time zone,
	"database_cleanup_completed_at" timestamp(3) with time zone,
	"reset_result" jsonb,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"failure" jsonb,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"value" text NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution" (
	"result" json,
	"payload" json,
	"checkpoint" json,
	"account_user_id" text,
	"cleared_at" timestamp(3) with time zone,
	"expired_at" timestamp(3) with time zone,
	"parent_execution_id" text,
	"completed_at" timestamp(3) with time zone,
	"parent_workflow_name" text,
	"execution_id" text,
	"workflow_name" text,
	"root_execution_id" text NOT NULL,
	"root_workflow_name" text NOT NULL,
	"suspension" text,
	"status" text NOT NULL,
	CONSTRAINT "workflow_execution_pkey" PRIMARY KEY("workflow_name","execution_id"),
	CONSTRAINT "workflow_execution_status_check" CHECK ("status" in ('active', 'succeeded', 'failed')),
	CONSTRAINT "workflow_execution_suspension_check" CHECK ("suspension" is null or "suspension" in ('failed', 'waiting')),
	CONSTRAINT "workflow_execution_completion_check" CHECK (("status" = 'active') = ("completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"exit" json,
	"fire_at" timestamp(3) with time zone,
	"name" text,
	"attempt" integer,
	"execution_id" text,
	"workflow_name" text,
	"kind" text,
	CONSTRAINT "workflow_step_pkey" PRIMARY KEY("workflow_name","execution_id","kind","name","attempt"),
	CONSTRAINT "workflow_step_kind_check" CHECK ("kind" in ('activity', 'clock', 'deferred')),
	CONSTRAINT "workflow_step_clock_check" CHECK (("kind" = 'clock') = ("fire_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_turn_active_unique" ON "assistant_turn" ("conversation_id") WHERE "status" in ('queued', 'running', 'awaiting-approval');--> statement-breakpoint
CREATE INDEX "automation_run_reconciliation_idx" ON "automation_run" ("status","next_attempt_at","queued_at","id");--> statement-breakpoint
CREATE INDEX "automation_run_history_idx" ON "automation_run" ("execution_user_id","queued_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_run_trigger_idx" ON "automation_run" ("trigger_id");--> statement-breakpoint
CREATE INDEX "automation_run_plugin_idx" ON "automation_run" ("plugin_id");--> statement-breakpoint
CREATE INDEX "automation_run_revision_idx" ON "automation_run" ("plugin_revision_id");--> statement-breakpoint
CREATE INDEX "automation_run_config_idx" ON "automation_run" ("plugin_config_revision_id");--> statement-breakpoint
CREATE INDEX "automation_run_script_idx" ON "automation_run" ("sandbox_script_id");--> statement-breakpoint
CREATE INDEX "automation_run_artifact_retention_idx" ON "automation_run" ("artifacts_expire_at","id");--> statement-breakpoint
CREATE INDEX "automation_run_history_retention_idx" ON "automation_run" ("queued_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_attempt_one_running" ON "automation_run_attempt" ("run_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "automation_run_attempt_retention_idx" ON "automation_run_attempt" ("started_at","id");--> statement-breakpoint
CREATE INDEX "automation_trigger_root_idx" ON "automation_trigger" ("root_execution_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_parent_run_idx" ON "automation_trigger" ("parent_run_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_parent_trigger_idx" ON "automation_trigger" ("parent_trigger_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_scope_idx" ON "automation_trigger" ("scope_user_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_retention_idx" ON "automation_trigger" ("created_at","id");--> statement-breakpoint
CREATE INDEX "automation_trigger_recipient_user_idx" ON "automation_trigger_recipient" ("user_id","trigger_id");--> statement-breakpoint
CREATE INDEX "backup_run_user_id_idx" ON "backup_run" ("user_id");--> statement-breakpoint
CREATE INDEX "backup_run_status_idx" ON "backup_run" ("status");--> statement-breakpoint
CREATE INDEX "backup_run_expires_at_idx" ON "backup_run" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_run_user_active_unique" ON "backup_run" ("user_id") WHERE "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "backup_staging_record_run_section_id_idx" ON "backup_staging_record" ("run_id","section","id");--> statement-breakpoint
CREATE INDEX "backup_staging_reference_run_target_idx" ON "backup_staging_reference" ("run_id","target_namespace","target_id");--> statement-breakpoint
CREATE INDEX "definition_calendar_source_slug_idx" ON "definition_calendar_source" ("slug");--> statement-breakpoint
CREATE INDEX "definition_entity_schema_slug_idx" ON "definition_entity_schema" ("slug");--> statement-breakpoint
CREATE INDEX "definition_import_source_slug_idx" ON "definition_import_source" ("slug");--> statement-breakpoint
CREATE INDEX "definition_integration_provider_slug_idx" ON "definition_integration_provider" ("slug");--> statement-breakpoint
CREATE INDEX "definition_relationship_schema_slug_idx" ON "definition_relationship_schema" ("slug");--> statement-breakpoint
CREATE INDEX "definition_saved_view_slug_idx" ON "definition_saved_view" ("slug");--> statement-breakpoint
CREATE INDEX "definition_signal_schema_slug_idx" ON "definition_signal_schema" ("slug");--> statement-breakpoint
CREATE INDEX "derived_value_subject_idx" ON "derived_value" ("subject_entity_id","user_id");--> statement-breakpoint
CREATE INDEX "entity_user_schema_name_idx" ON "entity" ("user_id","entity_schema_slug","name");--> statement-breakpoint
CREATE INDEX "entity_external_id_idx" ON "entity" ("external_id");--> statement-breakpoint
CREATE INDEX "entity_provider_id_idx" ON "entity" ("provider_id");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_slug_idx" ON "entity" ("entity_schema_slug");--> statement-breakpoint
CREATE INDEX "entity_schema_occurs_at_idx" ON "entity" ("entity_schema_slug","occurs_at");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_plugin_id_idx" ON "entity" ("entity_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "entity_properties_idx" ON "entity" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "entity_check_after_idx" ON "entity" ("check_after") WHERE "provider_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_collection_name_unique" ON "entity" ("user_id","name") WHERE "entity_schema_slug" = 'collection' and "entity_schema_plugin_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_external_identity_unique" ON "entity" ("external_id","entity_schema_slug",(case when "user_id" is null then '0' else '1' || "user_id" end),(case when "provider_id" is null then '0' else '1' || "provider_id" end),(case when "entity_schema_plugin_id" is null then '0' else '1' || "entity_schema_plugin_id" end)) WHERE "external_id" is not null and ("user_id" is null or "provider_id" is not null);--> statement-breakpoint
CREATE INDEX "entity_enrichment_request_entity_idx" ON "entity_enrichment_request" ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "entity_enrichment_request_joined_idx" ON "entity_enrichment_request" ("joined_to");--> statement-breakpoint
CREATE INDEX "entity_enrichment_request_pending_idx" ON "entity_enrichment_request" ("state","created_at");--> statement-breakpoint
CREATE INDEX "entity_enrichment_request_target_idx" ON "entity_enrichment_request" ("provider_id","external_id","scope_user_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_enrichment_request_retry_unique" ON "entity_enrichment_request" ("retry_of");--> statement-breakpoint
CREATE INDEX "entity_translation_entity_id_idx" ON "entity_translation" ("entity_id");--> statement-breakpoint
CREATE INDEX "event_entity_id_idx" ON "event" ("entity_id");--> statement-breakpoint
CREATE INDEX "event_event_schema_plugin_id_idx" ON "event" ("event_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_properties_idx" ON "event" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "event_user_entity_schema_order_idx" ON "event" ("user_id","entity_id","event_schema_slug","occurred_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_user_schema_occurred_at_idx" ON "event" ("user_id","event_schema_plugin_id","event_schema_slug","occurred_at");--> statement-breakpoint
CREATE INDEX "event_user_session_order_idx" ON "event" ("user_id","session_entity_id","occurred_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_reference_referenced_event_id_idx" ON "event_reference" ("referenced_event_id");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_item_payload_ordinal_unique" ON "import_item" ("run_id","phase","ordinal") WHERE "kind" = 'payload';--> statement-breakpoint
CREATE UNIQUE INDEX "import_item_batch_ordinal_unique" ON "import_item" ("run_id","ordinal") WHERE "kind" = 'batch';--> statement-breakpoint
CREATE INDEX "import_run_block_deadline_idx" ON "import_run" ("block_deadline") WHERE "status" = 'blocked';--> statement-breakpoint
CREATE INDEX "import_run_user_id_created_at_idx" ON "import_run" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_integration_id_created_at_idx" ON "import_run" ("integration_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_run_plugin_installation_id_idx" ON "import_run" ("plugin_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_run_integration_active_unique" ON "import_run" ("integration_id") WHERE "integration_lot" = 'yank' and "status" in ('pending', 'blocked', 'running', 'cancelling');--> statement-breakpoint
CREATE INDEX "integration_user_id_created_at_idx" ON "integration" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_user_id_provider_idx" ON "integration" ("user_id","provider");--> statement-breakpoint
CREATE INDEX "integration_plugin_installation_id_idx" ON "integration" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "integration_lot_is_disabled_idx" ON "integration" ("lot","is_disabled");--> statement-breakpoint
CREATE INDEX "integration_provider_is_disabled_idx" ON "integration" ("provider","is_disabled");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_token_unique" ON "integration" ("webhook_token");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queued_key_unique" ON "job" ("kind","key") WHERE "status" = 'queued' and "key" is not null;--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" ("kind","priority","run_at","id") WHERE "status" = 'queued';--> statement-breakpoint
CREATE INDEX "job_failed_idx" ON "job" ("updated_at") WHERE "status" = 'failed';--> statement-breakpoint
CREATE INDEX "managed_asset_owner_user_id_idx" ON "managed_asset" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "managed_asset_check_after_idx" ON "managed_asset" ("check_after") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "managed_asset_retired_at_idx" ON "managed_asset" ("retired_at") WHERE "retired_at" is not null;--> statement-breakpoint
CREATE INDEX "migration_report_detail_report_seq_seq_idx" ON "migration_report_detail" ("report_seq","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_idx" ON "notification" ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "notification_owner_idx" ON "notification" ("user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notification_source_run_idx" ON "notification" ("source_run_id");--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_created_at_idx" ON "notification_channel" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_channel_user_id_is_disabled_idx" ON "notification_channel" ("user_id","is_disabled");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_channel_idx" ON "notification_delivery" ("notification_id","channel_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_claim_idx" ON "notification_delivery" ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_retention_idx" ON "notification_delivery" ("settled_at");--> statement-breakpoint
CREATE INDEX "notification_subscription_user_id_idx" ON "notification_subscription" ("user_id");--> statement-breakpoint
CREATE INDEX "notification_subscription_signal_schema_plugin_id_idx" ON "notification_subscription" ("signal_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_clientId_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_sessionId_idx" ON "oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_userId_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refreshId_idx" ON "oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorizationCodeId_idx" ON "oauth_access_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauth_client_userId_idx" ON "oauth_client" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_clientId_idx" ON "oauth_client_resource" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resourceId_idx" ON "oauth_client_resource" ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_resource_clientId_resourceId_uidx" ON "oauth_client_resource" ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauth_connection_user_id_status_idx" ON "oauth_connection" ("user_id","status");--> statement-breakpoint
CREATE INDEX "oauth_connection_expires_at_idx" ON "oauth_connection" ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_consent_clientId_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_userId_idx" ON "oauth_consent" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_clientId_idx" ON "oauth_refresh_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_sessionId_idx" ON "oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_userId_idx" ON "oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorizationCodeId_idx" ON "oauth_refresh_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "plugin_owner_id_idx" ON "plugin" ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_owner_package_id_unique" ON "plugin" ("package_id",(case when "owner_user_id" is null then '0' else '1' || "owner_user_id" end));--> statement-breakpoint
CREATE INDEX "plugin_config_revision_installation_idx" ON "plugin_config_revision" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "plugin_config_revision_owner_idx" ON "plugin_config_revision" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "plugin_config_revision_package_idx" ON "plugin_config_revision" ("plugin_revision_id");--> statement-breakpoint
CREATE INDEX "plugin_installation_user_id_idx" ON "plugin_installation" ("user_id");--> statement-breakpoint
CREATE INDEX "plugin_installation_plugin_id_idx" ON "plugin_installation" ("plugin_id");--> statement-breakpoint
CREATE INDEX "publication_user_id_idx" ON "publication" ("user_id");--> statement-breakpoint
CREATE INDEX "publication_link_publication_id_idx" ON "publication_link" ("publication_id");--> statement-breakpoint
CREATE INDEX "relationship_schema_slug_idx" ON "relationship" ("relationship_schema_slug");--> statement-breakpoint
CREATE INDEX "relationship_schema_plugin_id_idx" ON "relationship" ("relationship_schema_plugin_id");--> statement-breakpoint
CREATE INDEX "relationship_user_schema_idx" ON "relationship" ("user_id","relationship_schema_plugin_id","relationship_schema_slug");--> statement-breakpoint
CREATE INDEX "relationship_source_schema_idx" ON "relationship" ("source_entity_id","relationship_schema_slug");--> statement-breakpoint
CREATE INDEX "relationship_target_entity_id_idx" ON "relationship" ("target_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_properties_idx" ON "relationship" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "relationship_collection_order_idx" ON "relationship" ("target_entity_id",(case when "relationship_schema_slug" = 'member-of' and "relationship_schema_plugin_id" is null then ("properties" ->> 'rank')::double precision end),"source_entity_id") WHERE "relationship_schema_slug" = 'member-of' and "relationship_schema_plugin_id" is null;--> statement-breakpoint
CREATE INDEX "reminder_due_idx" ON "reminder" ("state","due_at","id");--> statement-breakpoint
CREATE INDEX "reminder_reconcile_idx" ON "reminder" ("state","reconcile_at","id");--> statement-breakpoint
CREATE INDEX "reminder_owner_idx" ON "reminder" ("user_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "reminder_entity_idx" ON "reminder" ("entity_id","user_id");--> statement-breakpoint
CREATE INDEX "reminder_parent_idx" ON "reminder" ("parent_entity_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_formatter_idx" ON "reminder" ("formatter_run_id");--> statement-breakpoint
CREATE INDEX "sandbox_journal_entry_created_at_idx" ON "sandbox_journal_entry" ("created_at");--> statement-breakpoint
CREATE INDEX "sandbox_provider_plugin_id_idx" ON "sandbox_provider" ("plugin_id");--> statement-breakpoint
CREATE INDEX "sandbox_provider_root_entity_schema_slug_idx" ON "sandbox_provider" ("root_entity_schema_slug");--> statement-breakpoint
CREATE INDEX "sandbox_script_provider_id_idx" ON "sandbox_script" ("provider_id");--> statement-breakpoint
CREATE INDEX "sandbox_script_plugin_revision_id_idx" ON "sandbox_script" ("plugin_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_script_kernel_slug_content_hash_unique" ON "sandbox_script" ("slug","content_hash") WHERE "plugin_revision_id" is null;--> statement-breakpoint
CREATE INDEX "sandbox_workflow_reference_script_id_idx" ON "sandbox_workflow_reference" ("script_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_reference_plugin_installation_id_idx" ON "sandbox_workflow_reference" ("plugin_installation_id");--> statement-breakpoint
CREATE INDEX "saved_view_user_id_idx" ON "saved_view" ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_slug_idx" ON "saved_view" ("slug");--> statement-breakpoint
CREATE INDEX "saved_view_plugin_installation_id_idx" ON "saved_view" ("plugin_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_override_kernel_unique" ON "saved_view_override" ("user_id","slug") WHERE "plugin_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_override_plugin_unique" ON "saved_view_override" ("user_id","plugin_id","slug") WHERE "plugin_id" is not null;--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "signal_schedule_delivery_created_at_idx" ON "signal_schedule_delivery" ("created_at");--> statement-breakpoint
CREATE INDEX "transient_value_expires_at_idx" ON "transient_value" ("expires_at");--> statement-breakpoint
CREATE INDEX "upload_intent_deadline_idx" ON "upload_intent" ("deadline");--> statement-breakpoint
CREATE INDEX "user_lifecycle_operation_user_id_idx" ON "user_lifecycle_operation" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lifecycle_operation_user_active_unique" ON "user_lifecycle_operation" ("user_id") WHERE "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "workflow_execution_execution_id_idx" ON "workflow_execution" ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_root_idx" ON "workflow_execution" ("root_workflow_name","root_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_active_idx" ON "workflow_execution" ("workflow_name","execution_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "workflow_execution_account_idx" ON "workflow_execution" ("account_user_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "workflow_execution_cleanup_idx" ON "workflow_execution" ("expired_at") WHERE "expired_at" is not null and "cleared_at" is null;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_script_execution" ADD CONSTRAINT "agent_script_execution_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_5nOssrZ23nTD_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_provider" ADD CONSTRAINT "assistant_provider_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_tool_call" ADD CONSTRAINT "assistant_tool_call_kwOjAAwu8Gpn_fkey" FOREIGN KEY ("turn_id","conversation_id","user_id") REFERENCES "assistant_turn"("id","conversation_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assistant_turn" ADD CONSTRAINT "assistant_turn_dX1hPmBw1nmZ_fkey" FOREIGN KEY ("conversation_id","user_id") REFERENCES "assistant_conversation"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_sandbox_script_id_sandbox_script_id_fkey" FOREIGN KEY ("sandbox_script_id") REFERENCES "sandbox_script"("id");--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_execution_user_id_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_plugin_revision_id_plugin_revision_id_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_trigger_id_automation_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "automation_trigger"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_u6uLQTBn0kdP_fkey" FOREIGN KEY ("plugin_config_revision_id") REFERENCES "plugin_config_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_revision_owner_fk" FOREIGN KEY ("plugin_revision_id","plugin_id") REFERENCES "plugin_revision"("id","plugin_id");--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_config_revision_fk" FOREIGN KEY ("plugin_config_revision_id","plugin_revision_id") REFERENCES "plugin_config_revision"("id","plugin_revision_id");--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_script_revision_fk" FOREIGN KEY ("sandbox_script_id","plugin_revision_id") REFERENCES "sandbox_script"("id","plugin_revision_id");--> statement-breakpoint
ALTER TABLE "automation_run_attempt" ADD CONSTRAINT "automation_run_attempt_run_id_automation_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_scope_user_id_user_id_fkey" FOREIGN KEY ("scope_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "automation_trigger_recipient" ADD CONSTRAINT "automation_trigger_recipient_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_trigger_recipient" ADD CONSTRAINT "automation_trigger_recipient_79FlgkqvTsH0_fkey" FOREIGN KEY ("trigger_id") REFERENCES "automation_trigger"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_staging_record" ADD CONSTRAINT "backup_staging_record_run_id_backup_staging_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backup_staging_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_staging_reference" ADD CONSTRAINT "backup_staging_reference_run_id_backup_staging_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backup_staging_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_staging_run" ADD CONSTRAINT "backup_staging_run_backup_run_id_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendar_source_override" ADD CONSTRAINT "calendar_source_override_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client_artifact_file" ADD CONSTRAINT "client_artifact_file_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "definition_calendar_source" ADD CONSTRAINT "definition_calendar_source_zr3mUgmh593q_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_entity_schema" ADD CONSTRAINT "definition_entity_schema_cgKz3LGPs2D1_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_event_schema" ADD CONSTRAINT "definition_event_schema_teyj1WWBsLDW_fkey" FOREIGN KEY ("entity_schema_id") REFERENCES "definition_entity_schema"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_import_source" ADD CONSTRAINT "definition_import_source_9QXqIT7s6wRv_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_integration_provider" ADD CONSTRAINT "definition_integration_provider_Xf8wFlO3evuA_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_provider" ADD CONSTRAINT "definition_provider_plugin_revision_id_plugin_revision_id_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_provider_operation" ADD CONSTRAINT "definition_provider_operation_provider_fk" FOREIGN KEY ("plugin_revision_id","provider_slug") REFERENCES "definition_provider"("plugin_revision_id","slug") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_relationship_schema" ADD CONSTRAINT "definition_relationship_schema_F2xV1mUphM5y_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_saved_view" ADD CONSTRAINT "definition_saved_view_bGBIhUsWSMr5_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_signal_schedule" ADD CONSTRAINT "definition_signal_schedule_RGT3p54KQeok_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "definition_signal_schema" ADD CONSTRAINT "definition_signal_schema_kHnAff4N3xqs_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "derived_value" ADD CONSTRAINT "derived_value_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "derived_value" ADD CONSTRAINT "derived_value_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "derived_value" ADD CONSTRAINT "derived_value_subject_entity_id_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_entity_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("entity_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_enrichment_request" ADD CONSTRAINT "entity_enrichment_request_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity_enrichment_request" ADD CONSTRAINT "entity_enrichment_request_scope_user_id_user_id_fkey" FOREIGN KEY ("scope_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity_enrichment_request" ADD CONSTRAINT "entity_enrichment_request_requester_user_id_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity_enrichment_request" ADD CONSTRAINT "entity_enrichment_request_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity_translation" ADD CONSTRAINT "entity_translation_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fkey" FOREIGN KEY ("session_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("event_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_reference" ADD CONSTRAINT "event_reference_referencing_event_id_event_id_fkey" FOREIGN KEY ("referencing_event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_scope" ADD CONSTRAINT "event_scope_event_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("event_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_scope" ADD CONSTRAINT "event_scope_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_scope" ADD CONSTRAINT "event_scope_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_activity" ADD CONSTRAINT "import_activity_run_id_import_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_activity" ADD CONSTRAINT "import_activity_run_id_parent_id_import_activity_run_id_id_fkey" FOREIGN KEY ("run_id","parent_id") REFERENCES "import_activity"("run_id","id");--> statement-breakpoint
ALTER TABLE "import_issue" ADD CONSTRAINT "import_issue_run_id_import_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_run_id_import_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_integration_id_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_plugin_installation_id_plugin_installation_id_fkey" FOREIGN KEY ("plugin_installation_id") REFERENCES "plugin_installation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_integration_id_user_id_integration_id_user_id_fkey" FOREIGN KEY ("integration_id","user_id") REFERENCES "integration"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_Q1xPD5Jsz3qI_fkey" FOREIGN KEY ("plugin_installation_id","user_id") REFERENCES "plugin_installation"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "kernel_script" ADD CONSTRAINT "kernel_script_script_id_sandbox_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "sandbox_script"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "managed_asset" ADD CONSTRAINT "managed_asset_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "migration_report_detail" ADD CONSTRAINT "migration_report_detail_report_seq_migration_report_seq_fkey" FOREIGN KEY ("report_seq") REFERENCES "migration_report"("seq") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_uHCTRrCak7Fg_fkey" FOREIGN KEY ("signal_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_dn2L1gs9Dolm_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_installation_owner_fk" FOREIGN KEY ("plugin_installation_id","user_id") REFERENCES "plugin_installation"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_integration_owner_fk" FOREIGN KEY ("integration_id","user_id","plugin_installation_id","integration_provider_slug") REFERENCES "integration"("id","user_id","plugin_installation_id","provider") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id");--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_draft_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("draft_artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_published_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("published_artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_active_revision_owner_fk" FOREIGN KEY ("active_revision_id","id") REFERENCES "plugin_revision"("id","plugin_id");--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_environment_config_revision_fk" FOREIGN KEY ("environment_config_revision_id","active_revision_id") REFERENCES "plugin_config_revision"("id","plugin_revision_id");--> statement-breakpoint
ALTER TABLE "plugin_config_revision" ADD CONSTRAINT "plugin_config_revision_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_config_revision" ADD CONSTRAINT "plugin_config_revision_MfinRSKKKQP6_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_config_revision" ADD CONSTRAINT "plugin_config_revision_bpJawOzD6ygG_fkey" FOREIGN KEY ("plugin_installation_id") REFERENCES "plugin_installation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "plugin_installation" ADD CONSTRAINT "plugin_installation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_installation" ADD CONSTRAINT "plugin_installation_Y0qNbD8s1JVH_fkey" FOREIGN KEY ("active_config_revision_id") REFERENCES "plugin_config_revision"("id");--> statement-breakpoint
ALTER TABLE "plugin_installation" ADD CONSTRAINT "plugin_installation_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plugin_revision" ADD CONSTRAINT "plugin_revision_owner_package_fk" FOREIGN KEY ("plugin_id","package_id") REFERENCES "plugin"("id","package_id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "plugin_revision" ADD CONSTRAINT "plugin_revision_client_artifact_package_fk" FOREIGN KEY ("client_artifact_hash","package_id") REFERENCES "client_artifact"("hash","package_id");--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_snapshot_artifact_hash_client_artifact_hash_fkey" FOREIGN KEY ("snapshot_artifact_hash") REFERENCES "client_artifact"("hash");--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_page_owner_fk" FOREIGN KEY ("page_id","user_id") REFERENCES "page"("id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "publication_link" ADD CONSTRAINT "publication_link_publication_id_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publication"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_relationship_schema_plugin_id_plugin_id_fkey" FOREIGN KEY ("relationship_schema_plugin_id") REFERENCES "plugin"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_parent_entity_id_entity_id_fkey" FOREIGN KEY ("parent_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_provider" ADD CONSTRAINT "sandbox_provider_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_provider_id_sandbox_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sandbox_provider"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_plugin_revision_id_plugin_revision_id_fkey" FOREIGN KEY ("plugin_revision_id") REFERENCES "plugin_revision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_reference" ADD CONSTRAINT "sandbox_workflow_reference_NZbiTLiwtL2v_fkey" FOREIGN KEY ("plugin_installation_id") REFERENCES "plugin_installation"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_reference" ADD CONSTRAINT "sandbox_workflow_reference_script_id_sandbox_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "sandbox_script"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_page_owner_fk" FOREIGN KEY ("page_id","user_id") REFERENCES "page"("id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_plugin_installation_owner_fk" FOREIGN KEY ("plugin_installation_id","user_id") REFERENCES "plugin_installation"("id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "saved_view_override" ADD CONSTRAINT "saved_view_override_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signal_schedule_delivery" ADD CONSTRAINT "signal_schedule_delivery_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signal_schedule_delivery" ADD CONSTRAINT "signal_schedule_delivery_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_9KAI5HOPHafJ_fkey" FOREIGN KEY ("workflow_name","execution_id") REFERENCES "workflow_execution"("workflow_name","execution_id") ON DELETE CASCADE;
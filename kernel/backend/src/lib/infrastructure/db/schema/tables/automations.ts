import type { AutomationHistoryAttempt } from "@ryot-app/contract/modules/automations/history-schemas";
import type {
	AutomationTrigger,
	AutomationRun,
	AutomationRunAttempt,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationRuleMetadata } from "@ryot-app/contract/modules/automations/schemas";
import { NotificationSubscriptionId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	primaryKey,
	snakeCase,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, pluginRevision, pluginConfigRevision, sandboxScript } from "./core";

export const automationTrigger = snakeCase.table(
	"automation_trigger",
	{
		initiatorId: text(),
		parentRunId: text(),
		importRunId: text(),
		integrationId: text(),
		parentTriggerId: text(),
		id: text().primaryKey(),
		depth: integer().notNull(),
		providerExecutionId: text(),
		executionId: text().notNull(),
		rootExecutionId: text().notNull(),
		payloadPrunedAt: timestamp({ withTimezone: true }),
		payload: jsonb().$type<AutomationTrigger["payload"]>(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		blockedReason: jsonb().$type<AutomationTrigger["blockedReason"]>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		scopeUserId: text().references(() => user.id, { onDelete: "set null" }),
		category: text().$type<AutomationTrigger["kind"]["category"]>().notNull(),
		source: text().$type<AutomationTrigger["causation"]["source"]>().notNull(),
		operation: text().$type<AutomationTrigger["kind"]["operation"]>().notNull(),
		resourceKind: text().$type<AutomationTrigger["kind"]["resource"]>().notNull(),
		initiatorKind: text().$type<AutomationTrigger["causation"]["initiator"]["kind"]>().notNull(),
	},
	(table) => [
		index("automation_trigger_root_idx").on(table.rootExecutionId),
		index("automation_trigger_parent_run_idx").on(table.parentRunId),
		index("automation_trigger_parent_trigger_idx").on(table.parentTriggerId),
		index("automation_trigger_scope_idx").on(table.scopeUserId),
		index("automation_trigger_retention_idx").on(table.createdAt, table.id),
		check(
			"automation_trigger_kind_check",
			sql`(${table.category} in ('request', 'change') and ${table.resourceKind} in ('entity', 'event', 'relationship') and ${table.operation} in ('create', 'update', 'delete')) or (${table.category} = 'change' and ${table.resourceKind} in ('entity', 'event', 'relationship') and ${table.operation} = 'batch') or (${table.category} = 'change' and ${table.resourceKind} = 'provider-entity-import' and ${table.operation} = 'complete') or (${table.category} = 'signal' and ${table.resourceKind} = 'signal' and ${table.operation} = 'emit')`,
		),
		check(
			"automation_trigger_causation_check",
			sql`${table.depth} >= 0 and ${table.initiatorKind} in ('user', 'integration', 'system') and ${table.source} in ('api', 'import', 'integration', 'bootstrap', 'provider-refresh', 'automation') and (${table.source} <> 'automation' or (${table.parentRunId} is not null and ${table.parentTriggerId} is not null and ${table.depth} > 0))`,
		),
		check(
			"automation_trigger_payload_check",
			sql`(${table.payload} is null) = (${table.payloadPrunedAt} is not null)`,
		),
		check(
			"automation_trigger_parent_check",
			sql`${table.parentRunId} is null or ${table.parentTriggerId} is not null`,
		),
		check(
			"automation_trigger_initiator_check",
			sql`${table.initiatorKind} = 'system' or ${table.initiatorId} is not null`,
		),
		check(
			"automation_trigger_payload_kind_check",
			sql`${table.payload} is null or (jsonb_typeof(${table.payload}) = 'object' and (${table.payload}->>'category') is not distinct from ${table.category} and (${table.payload}->>'resource') is not distinct from ${table.resourceKind} and (${table.payload}->>'operation') is not distinct from ${table.operation})`,
		),
	],
);

export const automationTriggerRecipient = snakeCase.table(
	"automation_trigger_recipient",
	{
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		triggerId: text()
			.notNull()
			.references(() => automationTrigger.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.triggerId, table.userId] }),
		index("automation_trigger_recipient_user_idx").on(table.userId, table.triggerId),
	],
);

export const automationRun = snakeCase.table(
	"automation_run",
	{
		id: text().primaryKey(),
		hookSlug: text().notNull(),
		hookName: text().notNull(),
		scriptSlug: text().notNull(),
		scriptContentHash: text().notNull(),
		historyPayload: jsonb().$type<JsonValue>(),
		attemptCount: integer().notNull().default(0),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		nextAttemptAt: timestamp({ withTimezone: true }),
		stage: text().$type<AutomationRun["stage"]>().notNull(),
		skipReason: jsonb().$type<AutomationRun["skipReason"]>(),
		retryPolicy: jsonb().$type<AutomationRun["retryPolicy"]>(),
		sandboxScriptId: text().references(() => sandboxScript.id),
		historyPayloadTruncated: boolean().notNull().default(false),
		delivery: text().$type<AutomationRun["delivery"]>().notNull(),
		artifactsExpireAt: timestamp({ withTimezone: true }).notNull(),
		queuedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		pluginId: text().references(() => plugin.id, { onDelete: "cascade" }),
		executionUserId: text().references(() => user.id, { onDelete: "cascade" }),
		status: text().$type<AutomationRun["status"]>().notNull().default("queued"),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
		triggerId: text()
			.notNull()
			.references(() => automationTrigger.id, { onDelete: "cascade" }),
		pluginConfigRevisionId: text().references(() => pluginConfigRevision.id, {
			onDelete: "cascade",
		}),
	},
	(table) => [
		unique("automation_run_hook_recipient_unique")
			.on(table.triggerId, table.pluginId, table.hookSlug, table.executionUserId)
			.nullsNotDistinct(),
		foreignKey({
			name: "automation_run_revision_owner_fk",
			columns: [table.pluginRevisionId, table.pluginId],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}),
		foreignKey({
			name: "automation_run_config_revision_fk",
			columns: [table.pluginConfigRevisionId, table.pluginRevisionId],
			foreignColumns: [pluginConfigRevision.id, pluginConfigRevision.pluginRevisionId],
		}),
		foreignKey({
			name: "automation_run_script_revision_fk",
			columns: [table.sandboxScriptId, table.pluginRevisionId],
			foreignColumns: [sandboxScript.id, sandboxScript.pluginRevisionId],
		}),
		index("automation_run_reconciliation_idx").on(
			table.status,
			table.nextAttemptAt,
			table.queuedAt,
			table.id,
		),
		index("automation_run_history_idx").on(
			table.executionUserId,
			table.queuedAt.desc(),
			table.id.desc(),
		),
		index("automation_run_trigger_idx").on(table.triggerId),
		index("automation_run_plugin_idx").on(table.pluginId),
		index("automation_run_revision_idx").on(table.pluginRevisionId),
		index("automation_run_config_idx").on(table.pluginConfigRevisionId),
		index("automation_run_script_idx").on(table.sandboxScriptId),
		index("automation_run_artifact_retention_idx").on(table.artifactsExpireAt, table.id),
		index("automation_run_history_retention_idx").on(table.queuedAt, table.id),
		check(
			"automation_run_owner_check",
			sql`(${table.pluginId} is null and ${table.pluginRevisionId} is null and ${table.pluginConfigRevisionId} is null) or (${table.pluginId} is not null and ${table.pluginRevisionId} is not null and ${table.pluginConfigRevisionId} is not null)`,
		),
		check(
			"automation_run_stage_check",
			sql`(${table.stage} = 'before' and ${table.delivery} = 'policy' and ${table.retryPolicy} is null and ${table.nextAttemptAt} is null and ${table.attemptCount} <= 1) or (${table.stage} = 'after' and ${table.delivery} in ('required', 'async') and ${table.retryPolicy} is not null)`,
		),
		check(
			"automation_run_status_check",
			sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'rejected', 'skipped') and ${table.attemptCount} >= 0`,
		),
		check(
			"automation_run_live_script_check",
			sql`${table.status} not in ('queued', 'running') or ${table.sandboxScriptId} is not null`,
		),
	],
);

export const automationRunAttempt = snakeCase.table(
	"automation_run_attempt",
	{
		id: text().primaryKey(),
		retryable: boolean().notNull(),
		attemptNumber: integer().notNull(),
		workflowExecutionId: text().notNull(),
		finishedAt: timestamp({ withTimezone: true }),
		logs: jsonb().$type<AutomationRunAttempt["logs"]>(),
		artifactsPrunedAt: timestamp({ withTimezone: true }),
		error: jsonb().$type<AutomationRunAttempt["error"]>(),
		startedAt: timestamp({ withTimezone: true }).notNull(),
		timing: jsonb().$type<AutomationRunAttempt["timing"]>(),
		historyArtifactsTruncated: boolean().notNull().default(false),
		historyLogs: jsonb().$type<AutomationHistoryAttempt["logs"]>(),
		historyError: jsonb().$type<AutomationHistoryAttempt["error"]>(),
		status: text().$type<AutomationRunAttempt["status"]>().notNull(),
		failureKind: text().$type<AutomationRunAttempt["failureKind"]>(),
		returnedValue: jsonb().$type<AutomationRunAttempt["returnedValue"]>(),
		runId: text()
			.notNull()
			.references(() => automationRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("automation_run_attempt_number_unique").on(table.runId, table.attemptNumber),
		unique("automation_run_attempt_workflow_unique").on(table.workflowExecutionId),
		uniqueIndex("automation_run_attempt_one_running")
			.on(table.runId)
			.where(sql`${table.status} = 'running'`),
		index("automation_run_attempt_retention_idx").on(table.startedAt, table.id),
		check(
			"automation_run_attempt_state_check",
			sql`${table.attemptNumber} > 0 and ((${table.status} = 'running' and ${table.finishedAt} is null) or (${table.status} in ('succeeded', 'failed') and ${table.finishedAt} is not null))`,
		),
	],
);

export const notificationSubscription = snakeCase.table(
	"notification_subscription",
	{
		signalSchemaSlug: text().notNull(),
		isActive: boolean().notNull().default(true),
		metadata: jsonb().$type<AutomationRuleMetadata>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		signalSchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		id: text()
			.$type<NotificationSubscriptionId>()
			.primaryKey()
			.$defaultFn(() => NotificationSubscriptionId.make(generateId())),
	},
	(table) => [
		index("notification_subscription_user_id_idx").on(table.userId),
		index("notification_subscription_signal_schema_plugin_id_idx").on(table.signalSchemaPluginId),
		unique("notification_subscription_user_signal_unique")
			.on(table.userId, table.signalSchemaSlug, table.signalSchemaPluginId)
			.nullsNotDistinct(),
	],
);

import type {
	AutomationOperation,
	AutomationOrigin,
	AutomationRuleMetadata,
	SubscriptionRunSkipReason,
	SubscriptionRunSourceKind,
	SubscriptionRunStatus,
	SubscriptionRunTiming,
} from "@ryot-app/contract/modules/automations/schemas";
import { AutomationRuleId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	jsonb,
	primaryKey,
	snakeCase,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";

export const signal = snakeCase.table(
	"signal",
	{
		id: text().notNull().primaryKey(),
		signalSchemaSlug: text().notNull(),
		origin: jsonb().$type<AutomationOrigin>().notNull(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		actorUserId: text().references(() => user.id, { onDelete: "cascade" }),
		subjectEntityId: text().references(() => entity.id, { onDelete: "set null" }),
		signalSchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
	},
	(table) => [
		index("signal_actor_user_id_idx").on(table.actorUserId),
		index("signal_signal_schema_slug_idx").on(table.signalSchemaSlug),
		index("signal_signal_schema_plugin_id_idx").on(table.signalSchemaPluginId),
		index("signal_subject_entity_id_idx").on(table.subjectEntityId),
	],
);

export const signalRecipient = snakeCase.table(
	"signal_recipient",
	{
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		signalId: text()
			.notNull()
			.references(() => signal.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("signal_recipient_user_id_idx").on(table.userId),
		primaryKey({ columns: [table.signalId, table.userId] }),
	],
);

export const notificationSubscriptionState = snakeCase.table(
	"notification_subscription_state",
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		id: text()
			.$type<AutomationRuleId>()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ AutomationRuleId.make(generateId())),
	},
	(table) => [
		index("notification_subscription_state_user_id_idx").on(table.userId),
		index("notification_subscription_state_signal_schema_plugin_id_idx").on(
			table.signalSchemaPluginId,
		),
		unique("notification_subscription_state_user_signal_unique")
			.on(table.userId, table.signalSchemaSlug, table.signalSchemaPluginId)
			.nullsNotDistinct(),
	],
);

export const subscriptionRun = snakeCase.table(
	"subscription_run",
	{
		recordId: text(),
		ruleId: text().notNull(),
		ruleName: text().notNull(),
		occurrenceId: text().notNull(),
		sandboxScriptId: text().notNull(),
		id: text().notNull().primaryKey(),
		startedAt: timestamp({ withTimezone: true }),
		logs: jsonb().$type<AutomationRuleMetadata>(),
		finishedAt: timestamp({ withTimezone: true }),
		timing: jsonb().$type<SubscriptionRunTiming>(),
		scriptUpdatedAt: timestamp({ withTimezone: true }),
		ruleMetadata: jsonb().$type<AutomationRuleMetadata>(),
		sandboxError: jsonb().$type<AutomationRuleMetadata>(),
		skipReason: jsonb().$type<SubscriptionRunSkipReason>(),
		returnedValue: jsonb().$type<AutomationRuleMetadata>(),
		operation: text().$type<AutomationOperation>().notNull(),
		sourceKind: text().$type<SubscriptionRunSourceKind>().notNull(),
		queuedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		signalId: text().references(() => signal.id, { onDelete: "cascade" }),
		status: text().$type<SubscriptionRunStatus>().notNull().default("queued"),
		executionUserId: text().references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("subscription_run_execution_user_id_idx").on(table.executionUserId),
		index("subscription_run_rule_id_idx").on(table.ruleId),
		index("subscription_run_signal_id_idx").on(table.signalId),
		check(
			"subscription_run_operation_check",
			sql`${table.operation} in ('create', 'update', 'delete', 'signal')`,
		),
		check(
			"subscription_run_source_kind_check",
			sql`${table.sourceKind} in ('entity', 'event', 'relationship', 'signal')`,
		),
		check(
			"subscription_run_status_check",
			sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'skipped')`,
		),
		check(
			"subscription_run_source_check",
			sql`((${table.sourceKind} = 'signal' and ${table.operation} = 'signal' and ${table.signalId} is not null and ${table.recordId} is null) or (${table.sourceKind} <> 'signal' and ${table.operation} <> 'signal' and ${table.signalId} is null and ${table.recordId} is not null))`,
		),
	],
);

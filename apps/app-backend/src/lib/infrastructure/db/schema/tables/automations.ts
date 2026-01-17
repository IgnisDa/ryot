import type {
	AutomationOperation,
	AutomationOrigin,
	AutomationRuleKind,
	AutomationRuleMetadata,
	SubscriptionRunSkipReason,
	SubscriptionRunSourceKind,
	SubscriptionRunStatus,
	SubscriptionRunTiming,
} from "@ryot/contract/modules/automations/schemas";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { sandboxScript } from "./core";
import { entity } from "./entities";

export const signal = pgTable(
	"signal",
	{
		id: text().notNull().primaryKey(),
		origin: jsonb().$type<AutomationOrigin>().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		actorUserId: text().references(() => user.id, { onDelete: "cascade" }),
		signalSchemaSlug: text().notNull(),
		subjectEntityId: text().references(() => entity.id, { onDelete: "set null" }),
	},
	(table) => [
		index("signal_actor_user_id_idx").on(table.actorUserId),
		index("signal_signal_schema_slug_idx").on(table.signalSchemaSlug),
		index("signal_subject_entity_id_idx").on(table.subjectEntityId),
	],
);

export const signalRecipient = pgTable(
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

export const automationRule = pgTable(
	"automation_rule",
	{
		position: integer(),
		name: text().notNull(),
		metadata: jsonb().$type<AutomationRuleMetadata>(),
		isActive: boolean().notNull().default(true),
		kind: text().$type<AutomationRuleKind>().notNull(),
		isBuiltin: boolean().notNull().default(false),
		operation: text().$type<AutomationOperation>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		eventSchemaSlug: text(),
		entitySchemaSlug: text(),
		signalSchemaSlug: text(),
		relationshipSchemaSlug: text(),
		sandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("automation_rule_user_id_idx").on(table.userId),
		index("automation_rule_entity_schema_slug_idx").on(table.entitySchemaSlug),
		index("automation_rule_event_schema_slug_idx").on(table.eventSchemaSlug),
		index("automation_rule_relationship_schema_slug_idx").on(table.relationshipSchemaSlug),
		index("automation_rule_signal_schema_slug_idx").on(table.signalSchemaSlug),
		index("automation_rule_sandbox_script_id_idx").on(table.sandboxScriptId),
		uniqueIndex("automation_rule_user_entity_schema_unique")
			.on(table.userId, table.entitySchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is not null and ${table.entitySchemaSlug} is not null`),
		uniqueIndex("automation_rule_global_entity_schema_unique")
			.on(table.entitySchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is null and ${table.entitySchemaSlug} is not null`),
		uniqueIndex("automation_rule_user_event_schema_unique")
			.on(table.userId, table.eventSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is not null and ${table.eventSchemaSlug} is not null`),
		uniqueIndex("automation_rule_global_event_schema_unique")
			.on(table.eventSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is null and ${table.eventSchemaSlug} is not null`),
		uniqueIndex("automation_rule_user_relationship_schema_unique")
			.on(table.userId, table.relationshipSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is not null and ${table.relationshipSchemaSlug} is not null`),
		uniqueIndex("automation_rule_global_relationship_schema_unique")
			.on(table.relationshipSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is null and ${table.relationshipSchemaSlug} is not null`),
		uniqueIndex("automation_rule_user_signal_schema_unique")
			.on(table.userId, table.signalSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is not null and ${table.signalSchemaSlug} is not null`),
		uniqueIndex("automation_rule_global_signal_schema_unique")
			.on(table.signalSchemaSlug, table.operation, table.sandboxScriptId)
			.where(sql`${table.userId} is null and ${table.signalSchemaSlug} is not null`),
		check("automation_rule_kind_check", sql`${table.kind} in ('policy', 'subscription')`),
		check(
			"automation_rule_operation_check",
			sql`${table.operation} in ('create', 'update', 'delete', 'signal')`,
		),
		check(
			"automation_rule_one_target_check",
			sql`num_nonnulls(${table.entitySchemaSlug}, ${table.eventSchemaSlug}, ${table.relationshipSchemaSlug}, ${table.signalSchemaSlug}) = 1`,
		),
		check(
			"automation_rule_target_operation_check",
			sql`((${table.signalSchemaSlug} is not null and ${table.kind} = 'subscription' and ${table.operation} = 'signal') or (${table.signalSchemaSlug} is null and ${table.operation} <> 'signal'))`,
		),
		check(
			"automation_rule_position_check",
			sql`${table.kind} = 'policy' or ${table.position} is null`,
		),
	],
);

export const subscriptionRun = pgTable(
	"subscription_run",
	{
		recordId: text(),
		ruleName: text().notNull(),
		occurrenceId: text().notNull(),
		originalRuleId: text().notNull(),
		sandboxScriptId: text().notNull(),
		id: text().notNull().primaryKey(),
		logs: jsonb().$type<AutomationRuleMetadata>(),
		timing: jsonb().$type<SubscriptionRunTiming>(),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		ruleMetadata: jsonb().$type<AutomationRuleMetadata>(),
		sandboxError: jsonb().$type<AutomationRuleMetadata>(),
		skipReason: jsonb().$type<SubscriptionRunSkipReason>(),
		returnedValue: jsonb().$type<AutomationRuleMetadata>(),
		operation: text().$type<AutomationOperation>().notNull(),
		scriptUpdatedAt: timestamp({ withTimezone: true }),
		sourceKind: text().$type<SubscriptionRunSourceKind>().notNull(),
		queuedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		status: text().$type<SubscriptionRunStatus>().notNull().default("queued"),
		signalId: text().references(() => signal.id, { onDelete: "cascade" }),
		executionUserId: text().references(() => user.id, { onDelete: "cascade" }),
		ruleId: text().references(() => automationRule.id, { onDelete: "set null" }),
	},
	(table) => [
		index("subscription_run_execution_user_id_idx").on(table.executionUserId),
		index("subscription_run_rule_id_idx").on(table.ruleId),
		index("subscription_run_original_rule_id_idx").on(table.originalRuleId),
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

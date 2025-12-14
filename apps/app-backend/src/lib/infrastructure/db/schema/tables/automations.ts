import type {
	AutomationOrigin,
	AutomationRuleKind,
	AutomationRuleOperation,
	AutomationRuleSnapshot,
	SignalAudiencePolicy,
	SignalSchema,
	SubscriptionRunStatus,
} from "@ryot/contract/modules/automations/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { entitySchema, sandboxScript } from "./core";
import { entity, relationshipSchema } from "./entities";
import { eventSchema } from "./events";

export const signalSchema = pgTable(
	"signal_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		archivedAt: timestamp({ withTimezone: true }),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		audiencePolicy: jsonb().$type<SignalAudiencePolicy>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		catalogState: text().notNull().default("hidden").$type<SignalSchema["catalogState"]>(),
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
		index("signal_schema_user_id_idx").on(table.userId),
		unique("signal_schema_user_slug_unique").on(table.userId, table.slug),
		uniqueIndex("signal_schema_builtin_slug_unique")
			.on(table.slug)
			.where(sql`${table.userId} is null`),
		check("signal_schema_catalog_state_check", sql`${table.catalogState} in ('active', 'hidden')`),
	],
);

export const signal = pgTable(
	"signal",
	{
		causationId: text(),
		correlationId: text(),
		id: text().primaryKey(),
		origin: jsonb().$type<AutomationOrigin>().notNull(),
		automationDepth: integer().notNull().default(0),
		properties: jsonb().$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true, precision: 3 }).defaultNow().notNull(),
		actorUserId: text().references(() => user.id, { onDelete: "cascade" }),
		subjectEntityId: text().references(() => entity.id, { onDelete: "set null" }),
		signalSchemaId: text()
			.notNull()
			.references(() => signalSchema.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("signal_actor_user_id_idx").on(table.actorUserId),
		index("signal_signal_schema_id_idx").on(table.signalSchemaId),
		index("signal_subject_entity_id_idx").on(table.subjectEntityId),
	],
);

export const signalRecipient = pgTable(
	"signal_recipient",
	{
		signalCreatedAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		signalId: text()
			.notNull()
			.references(() => signal.id, { onDelete: "cascade" }),
		signalSchemaId: text()
			.notNull()
			.references(() => signalSchema.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("signal_recipient_signal_user_unique").on(table.signalId, table.userId),
		index("signal_recipient_user_created_signal_idx").on(
			table.userId,
			table.signalCreatedAt.desc(),
			table.signalId.desc(),
		),
		index("signal_recipient_user_schema_created_signal_idx").on(
			table.userId,
			table.signalSchemaId,
			table.signalCreatedAt.desc(),
			table.signalId.desc(),
		),
	],
);

export const automationRule = pgTable(
	"automation_rule",
	{
		position: integer(),
		name: text().notNull(),
		isActive: boolean().notNull().default(true),
		isBuiltin: boolean().notNull().default(false),
		kind: text().notNull().$type<AutomationRuleKind>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		operation: text().notNull().$type<AutomationRuleOperation>(),
		metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		eventSchemaId: text().references(() => eventSchema.id, { onDelete: "cascade" }),
		entitySchemaId: text().references(() => entitySchema.id, { onDelete: "cascade" }),
		signalSchemaId: text().references(() => signalSchema.id, { onDelete: "cascade" }),
		relationshipSchemaId: text().references(() => relationshipSchema.id, {
			onDelete: "cascade",
		}),
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
	(table) => {
		const userUnique = (name: string, target: typeof table.entitySchemaId) =>
			uniqueIndex(name)
				.on(table.userId, target, table.operation, table.sandboxScriptId)
				.where(sql`${target} is not null and ${table.userId} is not null`);
		const builtinUnique = (name: string, target: typeof table.entitySchemaId) =>
			uniqueIndex(name)
				.on(target, table.operation, table.sandboxScriptId)
				.where(sql`${target} is not null and ${table.userId} is null`);

		return [
			index("automation_rule_user_id_idx").on(table.userId),
			index("automation_rule_entity_schema_id_idx").on(table.entitySchemaId),
			index("automation_rule_event_schema_id_idx").on(table.eventSchemaId),
			index("automation_rule_signal_schema_id_idx").on(table.signalSchemaId),
			index("automation_rule_relationship_schema_id_idx").on(table.relationshipSchemaId),
			userUnique("automation_rule_user_entity_unique", table.entitySchemaId),
			userUnique("automation_rule_user_event_unique", table.eventSchemaId),
			userUnique("automation_rule_user_signal_unique", table.signalSchemaId),
			userUnique("automation_rule_user_relationship_unique", table.relationshipSchemaId),
			builtinUnique("automation_rule_builtin_entity_unique", table.entitySchemaId),
			builtinUnique("automation_rule_builtin_event_unique", table.eventSchemaId),
			builtinUnique("automation_rule_builtin_signal_unique", table.signalSchemaId),
			builtinUnique("automation_rule_builtin_relationship_unique", table.relationshipSchemaId),
			check("automation_rule_kind_check", sql`${table.kind} in ('policy', 'subscription')`),
			check(
				"automation_rule_operation_check",
				sql`${table.operation} in ('create', 'update', 'delete', 'signal')`,
			),
			check(
				"automation_rule_exactly_one_target_check",
				sql`num_nonnulls(${table.entitySchemaId}, ${table.eventSchemaId}, ${table.relationshipSchemaId}, ${table.signalSchemaId}) = 1`,
			),
			check(
				"automation_rule_target_operation_check",
				sql`(
					(${table.signalSchemaId} is not null and ${table.kind} = 'subscription' and ${table.operation} = 'signal')
					or
					(${table.signalSchemaId} is null and ${table.operation} <> 'signal')
				)`,
			),
		];
	},
);

export const subscriptionRun = pgTable(
	"subscription_run",
	{
		error: text(),
		recordId: text(),
		scriptHash: text(),
		causationId: text(),
		correlationId: text(),
		id: text().primaryKey(),
		lifecycleOccurrenceId: text(),
		value: jsonb().$type<unknown>(),
		originalRuleId: text().notNull(),
		automationDepth: integer().notNull(),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		skippedReason: jsonb().$type<Record<string, unknown>>(),
		scriptUpdatedAt: timestamp({ withTimezone: true }),
		sourceKind: text().$type<"entity" | "event" | "relationship">(),
		ruleSnapshot: jsonb().$type<AutomationRuleSnapshot>().notNull(),
		timing: jsonb().$type<{ totalMs: number; executionMs: number }>(),
		triggerSnapshot: jsonb().$type<Record<string, unknown>>().notNull(),
		logs: jsonb().$type<ReadonlyArray<string>>().notNull().default([]),
		queuedAt: timestamp({ withTimezone: true, precision: 3 }).defaultNow().notNull(),
		operation: text().notNull().$type<AutomationRuleOperation>(),
		signalId: text().references(() => signal.id, { onDelete: "cascade" }),
		executionUserId: text().references(() => user.id, { onDelete: "cascade" }),
		ruleId: text().references(() => automationRule.id, { onDelete: "set null" }),
		status: text().notNull().$type<SubscriptionRunStatus>(),
	},
	(table) => [
		index("subscription_run_execution_user_queued_id_idx").on(
			table.executionUserId,
			table.queuedAt.desc(),
			table.id.desc(),
		),
		index("subscription_run_original_rule_id_idx").on(table.originalRuleId),
		index("subscription_run_status_idx").on(table.status),
		check(
			"subscription_run_source_check",
			sql`(${table.signalId} is not null and ${table.operation} = 'signal' and ${table.lifecycleOccurrenceId} is null)
				or (${table.signalId} is null and ${table.operation} <> 'signal' and ${table.lifecycleOccurrenceId} is not null and ${table.sourceKind} is not null and ${table.recordId} is not null)`,
		),
	],
);

export const automationCorrelationBudget = pgTable("automation_correlation_budget", {
	correlationId: text().primaryKey(),
	consumedUnits: integer().notNull().default(0),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const automationEffect = pgTable(
	"automation_effect",
	{
		id: text().primaryKey(),
		effectKey: text().notNull(),
		inputHash: text().notNull(),
		downstreamExecutionId: text(),
		hostFunction: text().notNull(),
		result: jsonb().$type<unknown>(),
		correlationUnits: integer().notNull().default(0),
		status: text().notNull().$type<"pending" | "accepted" | "failed">(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		correlationId: text()
			.notNull()
			.references(() => automationCorrelationBudget.correlationId),
		parentRunId: text()
			.notNull()
			.references(() => subscriptionRun.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("automation_effect_parent_run_id_idx").on(table.parentRunId),
		index("automation_effect_correlation_id_idx").on(table.correlationId),
		check(
			"automation_effect_status_check",
			sql`${table.status} in ('pending', 'accepted', 'failed')`,
		),
	],
);

import type { NotificationOutcome } from "@ryot-app/contract/modules/notifications/delivery";
import type {
	ReminderReason,
	ReminderScheduleEvidence,
	ReminderState,
} from "@ryot-app/contract/modules/reminders/schemas";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core";

import type { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";

import { user } from "./auth";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const reminder = snakeCase.table(
	"reminder",
	{
		message: text(),
		timezone: text(),
		triggerId: text(),
		entityTitle: text(),
		dueAt: timestamptz(),
		replacementId: text(),
		formatterRunId: text(),
		id: text().primaryKey(),
		removedAt: timestamptz(),
		settledAt: timestamptz(),
		reconcileAt: timestamptz(),
		processingAt: timestamptz(),
		accountGeneration: text().notNull(),
		reason: text().$type<ReminderReason>(),
		revision: integer().notNull().default(1),
		outcome: text().$type<NotificationOutcome>(),
		state: text().$type<ReminderState>().notNull(),
		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
		dispatch: jsonb().$type<LifecycleDispatchPlan>(),
		originalSchedule: jsonb().$type<ReminderScheduleEvidence>(),
		entityId: text().references(() => entity.id, { onDelete: "set null" }),
		parentEntityId: text().references(() => entity.id, { onDelete: "set null" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("reminder_due_idx").on(table.state, table.dueAt, table.id),
		index("reminder_reconcile_idx").on(table.state, table.reconcileAt, table.id),
		index("reminder_owner_idx").on(table.userId, table.state, table.createdAt, table.id),
		index("reminder_entity_idx").on(table.entityId, table.userId),
		index("reminder_parent_idx").on(table.parentEntityId, table.userId),
		uniqueIndex("reminder_formatter_idx").on(table.formatterRunId),
		check("reminder_revision_check", sql`${table.revision} > 0`),
		check(
			"reminder_state_check",
			sql`${table.state} in ('needs-scheduling', 'scheduled', 'processing', 'settled', 'cancelled')`,
		),
		check(
			"reminder_schedule_check",
			sql`${table.state} not in ('scheduled', 'processing') or (${table.dueAt} is not null and ${table.timezone} is not null and ${table.entityId} is not null and ${table.reconcileAt} is not null)`,
		),
		check(
			"reminder_inactive_schedule_check",
			sql`${table.state} <> 'needs-scheduling' or (${table.dueAt} is null and ${table.timezone} is null and ${table.originalSchedule} is not null)`,
		),
		check(
			"reminder_processing_check",
			sql`${table.state} <> 'processing' or (${table.processingAt} is not null and ${table.formatterRunId} is not null and ${table.triggerId} is not null and ${table.dispatch} is not null and ${table.reconcileAt} is not null)`,
		),
		check(
			"reminder_outcome_check",
			sql`(${table.state} = 'settled' and ${table.outcome} in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and ${table.outcome} is not null and ${table.settledAt} is not null) or (${table.state} <> 'settled' and ${table.outcome} is null)`,
		),
		check(
			"reminder_content_check",
			sql`(${table.removedAt} is null and ${table.message} is not null and length(btrim(${table.message})) between 1 and 4000 and ${table.entityTitle} is not null) or (${table.removedAt} is not null and ${table.state} in ('settled', 'cancelled') and ${table.message} is null and ${table.entityTitle} is null and ${table.originalSchedule} is null)`,
		),
	],
);

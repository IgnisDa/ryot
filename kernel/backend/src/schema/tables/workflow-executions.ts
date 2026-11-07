import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	json,
	primaryKey,
	snakeCase,
	text,
} from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const workflowExecution = snakeCase.table(
	"workflow_execution",
	{
		owner: text(),
		// `json` keeps the encoded text, so replayed results match their originals byte for byte.
		result: json(),
		payload: json(),
		// The account the execution works for; account retirement interrupts it.
		accountUserId: text(),
		clearedAt: timestamptz(),
		expiredAt: timestamptz(),
		parentExecutionId: text(),
		completedAt: timestamptz(),
		parentWorkflowName: text(),
		executionId: text().notNull(),
		workflowName: text().notNull(),
		rootExecutionId: text().notNull(),
		rootWorkflowName: text().notNull(),
		// Set while the latest run suspended; `failed` runs wake only on an explicit resume.
		suspension: text().$type<"failed" | "waiting">(),
		status: text().$type<"active" | "failed" | "succeeded">().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.workflowName, table.executionId] }),
		index("workflow_execution_execution_id_idx").on(table.executionId),
		index("workflow_execution_root_idx").on(table.rootWorkflowName, table.rootExecutionId),
		index("workflow_execution_owner_idx")
			.on(table.owner)
			.where(sql`${table.status} = 'active'`),
		index("workflow_execution_account_idx")
			.on(table.accountUserId)
			.where(sql`${table.status} = 'active'`),
		index("workflow_execution_cleanup_idx")
			.on(table.expiredAt)
			.where(sql`${table.expiredAt} is not null and ${table.clearedAt} is null`),
		check(
			"workflow_execution_status_check",
			sql`${table.status} in ('active', 'succeeded', 'failed')`,
		),
		check(
			"workflow_execution_suspension_check",
			sql`${table.suspension} is null or ${table.suspension} in ('failed', 'waiting')`,
		),
		check(
			"workflow_execution_completion_check",
			sql`(${table.status} = 'active') = (${table.completedAt} is null)`,
		),
	],
);

// One row per completed activity attempt, deferred completion, or armed durable clock.
export const workflowStep = snakeCase.table(
	"workflow_step",
	{
		exit: json(),
		fireAt: timestamptz(),
		name: text().notNull(),
		attempt: integer().notNull(),
		executionId: text().notNull(),
		workflowName: text().notNull(),
		kind: text().$type<"clock" | "activity" | "deferred">().notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.workflowName, table.executionId, table.kind, table.name, table.attempt],
		}),
		foreignKey({
			columns: [table.workflowName, table.executionId],
			foreignColumns: [workflowExecution.workflowName, workflowExecution.executionId],
		}).onDelete("cascade"),
		check("workflow_step_kind_check", sql`${table.kind} in ('activity', 'clock', 'deferred')`),
		check(
			"workflow_step_clock_check",
			sql`(${table.kind} = 'clock') = (${table.fireAt} is not null)`,
		),
	],
);

// One row per engine process; executions whose owner's lease lapsed are taken over.
export const workflowRunner = snakeCase.table("workflow_runner", {
	id: text().primaryKey(),
	leaseUntil: timestamptz().notNull(),
});

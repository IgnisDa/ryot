import { sql } from "drizzle-orm";
import { check, index, primaryKey, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

export const workflowExecution = snakeCase.table(
	"workflow_execution",
	{
		shardId: text(),
		executionId: text().notNull(),
		workflowName: text().notNull(),
		rootExecutionId: text().notNull(),
		rootWorkflowName: text().notNull(),
		clearedAt: timestamp({ withTimezone: true }),
		expiredAt: timestamp({ withTimezone: true }),
		completedAt: timestamp({ withTimezone: true }),
		status: text().$type<"active" | "succeeded" | "failed">().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.workflowName, table.executionId] }),
		index("workflow_execution_root_idx").on(table.rootWorkflowName, table.rootExecutionId),
		index("workflow_execution_cleanup_idx")
			.on(table.expiredAt)
			.where(sql`${table.expiredAt} is not null and ${table.clearedAt} is null`),
		check(
			"workflow_execution_status_check",
			sql`${table.status} in ('active', 'succeeded', 'failed')`,
		),
		check(
			"workflow_execution_completion_check",
			sql`(${table.status} = 'active') = (${table.completedAt} is null)`,
		),
	],
);

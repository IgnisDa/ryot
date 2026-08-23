import type {
	UserLifecycleOperationFailure,
	UserLifecycleOperationKind,
	UserLifecycleOperationStatus,
	UserResetResult,
} from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const userLifecycleOperation = snakeCase.table(
	"user_lifecycle_operation",
	{
		id: text().primaryKey(),
		userId: text().notNull(),
		metadata: jsonb().notNull(),
		startedAt: timestamp({ withTimezone: true }),
		resetResult: jsonb().$type<UserResetResult>(),
		finishedAt: timestamp({ withTimezone: true }),
		workflowAttempt: integer().notNull().default(0),
		accessRevokedAt: timestamp({ withTimezone: true }),
		failure: jsonb().$type<UserLifecycleOperationFailure>(),
		kind: text().notNull().$type<UserLifecycleOperationKind>(),
		accessRevocationStartedAt: timestamp({ withTimezone: true }),
		databaseCleanupCompletedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		status: text().notNull().$type<UserLifecycleOperationStatus>().default("pending"),
	},
	(table) => [
		index("user_lifecycle_operation_user_id_idx").on(table.userId),
		uniqueIndex("user_lifecycle_operation_user_active_unique")
			.on(table.userId)
			.where(sql`${table.status} in ('pending', 'running')`),
	],
);

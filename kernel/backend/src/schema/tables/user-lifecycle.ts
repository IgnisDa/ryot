import type {
	UserLifecycleOperationFailure,
	UserLifecycleOperationKind,
	UserLifecycleOperationStatus,
	UserResetResult,
} from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
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
		resetResult: jsonb().$type<UserResetResult>(),
		workflowAttempt: integer().notNull().default(0),
		failure: jsonb().$type<UserLifecycleOperationFailure>(),
		startedAt: timestamp({ precision: 3, withTimezone: true }),
		kind: text().notNull().$type<UserLifecycleOperationKind>(),
		finishedAt: timestamp({ precision: 3, withTimezone: true }),
		accessRevokedAt: timestamp({ precision: 3, withTimezone: true }),
		accessRevocationStartedAt: timestamp({ precision: 3, withTimezone: true }),
		databaseCleanupCompletedAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		status: text().notNull().$type<UserLifecycleOperationStatus>().default("pending"),
	},
	(table) => [
		index("user_lifecycle_operation_user_id_idx").on(table.userId),
		uniqueIndex("user_lifecycle_operation_user_active_unique")
			.on(table.userId)
			.where(sql`${table.status} in ('pending', 'running')`),
	],
);

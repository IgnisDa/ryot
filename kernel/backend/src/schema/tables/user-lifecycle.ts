import type {
	UserLifecycleOperationFailure,
	UserLifecycleOperationKind,
	UserLifecycleOperationStatus,
	UserResetResult,
} from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const userLifecycleOperation = snakeCase.table(
	"user_lifecycle_operation",
	{
		id: text().primaryKey(),
		userId: text().notNull(),
		startedAt: timestamptz(),
		finishedAt: timestamptz(),
		metadata: jsonb().notNull(),
		accessRevokedAt: timestamptz(),
		accessRevocationStartedAt: timestamptz(),
		databaseCleanupCompletedAt: timestamptz(),
		resetResult: jsonb().$type<UserResetResult>(),
		workflowAttempt: integer().notNull().default(0),
		createdAt: timestamptz().defaultNow().notNull(),
		failure: jsonb().$type<UserLifecycleOperationFailure>(),
		kind: text().notNull().$type<UserLifecycleOperationKind>(),
		status: text().notNull().$type<UserLifecycleOperationStatus>().default("pending"),
	},
	(table) => [
		index("user_lifecycle_operation_user_id_idx").on(table.userId),
		uniqueIndex("user_lifecycle_operation_user_active_unique")
			.on(table.userId)
			.where(sql`${table.status} in ('pending', 'running')`),
	],
);

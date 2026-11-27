import type {
	BackupRunArtifactProvider,
	BackupRunFailure,
	BackupRunKind,
	BackupRunStatus,
} from "@ryot-app/contract/modules/backups/schemas";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	primaryKey,
	snakeCase,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export const backupRun = snakeCase.table(
	"backup_run",
	{
		artifactKey: text(),
		expiresAt: timestamptz(),
		startedAt: timestamptz(),
		finishedAt: timestamptz(),
		progress: integer().notNull().default(0),
		failure: jsonb().$type<BackupRunFailure>(),
		kind: text().notNull().$type<BackupRunKind>(),
		createdAt: timestamptz().defaultNow().notNull(),
		artifactProvider: text().$type<BackupRunArtifactProvider>(),
		status: text().notNull().$type<BackupRunStatus>().default("pending"),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("backup_run_user_id_idx").on(table.userId),
		index("backup_run_status_idx").on(table.status),
		index("backup_run_expires_at_idx").on(table.expiresAt),
		uniqueIndex("backup_run_user_active_unique")
			.on(table.userId)
			.where(sql`${table.status} in ('pending', 'running')`),
	],
);

export const backupStagingRun = snakeCase.table("backup_staging_run", {
	id: text().notNull().primaryKey(),
	expiresAt: timestamptz().notNull(),
	backupRunId: text()
		.notNull()
		.references(() => backupRun.id, { onDelete: "cascade" }),
});

export const backupStagingRecord = snakeCase.table(
	"backup_staging_record",
	{
		id: text().notNull(),
		destinationId: text(),
		section: text().notNull(),
		namespace: text().notNull(),
		value: jsonb().$type<unknown>().notNull(),
		inserted: boolean().notNull().default(false),
		runId: text()
			.notNull()
			.references(() => backupStagingRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.namespace, table.id] }),
		index("backup_staging_record_run_section_id_idx").on(table.runId, table.section, table.id),
	],
);

export const backupStagingReference = snakeCase.table(
	"backup_staging_reference",
	{
		sourceId: text().notNull(),
		targetId: text().notNull(),
		sourceNamespace: text().notNull(),
		targetNamespace: text().notNull(),
		runId: text()
			.notNull()
			.references(() => backupStagingRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({
			columns: [
				table.runId,
				table.sourceNamespace,
				table.sourceId,
				table.targetNamespace,
				table.targetId,
			],
		}),
		index("backup_staging_reference_run_target_idx").on(
			table.runId,
			table.targetNamespace,
			table.targetId,
		),
	],
);

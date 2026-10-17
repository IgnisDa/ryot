import type {
	BackupRunArtifactProvider,
	BackupRunFailure,
	BackupRunKind,
	BackupRunStatus,
} from "@ryot-app/contract/modules/backups/schemas";
import { generateId } from "better-auth";
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

import { user } from "./auth";

export const backupRun = snakeCase.table(
	"backup_run",
	{
		artifactKey: text(),
		progress: integer().notNull().default(0),
		failure: jsonb().$type<BackupRunFailure>(),
		kind: text().notNull().$type<BackupRunKind>(),
		expiresAt: timestamp({ precision: 3, withTimezone: true }),
		startedAt: timestamp({ precision: 3, withTimezone: true }),
		finishedAt: timestamp({ precision: 3, withTimezone: true }),
		artifactProvider: text().$type<BackupRunArtifactProvider>(),
		status: text().notNull().$type<BackupRunStatus>().default("pending"),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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

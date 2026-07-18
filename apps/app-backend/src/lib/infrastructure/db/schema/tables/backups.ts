import type {
	BackupRunArtifactProvider,
	BackupRunKind,
	BackupRunStatus,
} from "@ryot/contract/modules/backups/schemas";
import { generateId } from "better-auth";
import { index, integer, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const backupRun = snakeCase.table(
	"backup_run",
	{
		error: text(),
		artifactKey: text(),
		kind: text().notNull().$type<BackupRunKind>(),
		progress: integer().notNull().default(0),
		expiresAt: timestamp({ withTimezone: true }),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		artifactProvider: text().$type<BackupRunArtifactProvider>(),
		status: text().notNull().$type<BackupRunStatus>().default("pending"),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
	],
);

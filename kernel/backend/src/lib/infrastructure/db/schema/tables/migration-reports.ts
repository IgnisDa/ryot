import type { MigrationReportLevel } from "@ryot-app/contract/modules/god-mode/contract";
import { sql } from "drizzle-orm";
import {
	check,
	doublePrecision,
	integer,
	serial,
	snakeCase,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const migrationReport = snakeCase.table(
	"migration_report",
	{
		seq: serial().primaryKey(),
		count: integer(),
		phase: text().notNull(),
		level: text().notNull().$type<MigrationReportLevel>(),
		message: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		elapsedSeconds: doublePrecision(),
	},
	(table) => [check("migration_report_level_check", sql`${table.level} in ('info', 'warning')`)],
);

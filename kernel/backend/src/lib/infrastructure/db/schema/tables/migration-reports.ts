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
		count: integer(),
		phase: text().notNull(),
		message: text().notNull(),
		seq: serial().primaryKey(),
		elapsedSeconds: doublePrecision(),
		level: text().notNull().$type<MigrationReportLevel>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [check("migration_report_level_check", sql`${table.level} in ('info', 'warning')`)],
);

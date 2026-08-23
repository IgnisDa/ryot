import type {
	MigrationReportAnomalyCode,
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/god-mode/migration-report";
import { sql } from "drizzle-orm";
import {
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
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
		code: text().$type<MigrationReportAnomalyCode>(),
		level: text().notNull().$type<MigrationReportLevel>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check("migration_report_level_check", sql`${table.level} in ('info', 'warning')`),
		check(
			"migration_report_warning_code_check",
			sql`${table.level} <> 'warning' or ${table.code} is not null`,
		),
	],
);

export const migrationReportDetail = snakeCase.table(
	"migration_report_detail",
	{
		seq: serial().primaryKey(),
		detail: jsonb().$type<MigrationReportDetail>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		reportSeq: integer()
			.notNull()
			.references(() => migrationReport.seq, { onDelete: "cascade" }),
	},
	(table) => [index("migration_report_detail_report_seq_seq_idx").on(table.reportSeq, table.seq)],
);

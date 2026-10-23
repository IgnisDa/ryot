import type {
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/instance-admin/migration-report";
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
} from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const migrationReport = snakeCase.table(
	"migration_report",
	{
		code: text(),
		count: integer(),
		phase: text().notNull(),
		message: text().notNull(),
		seq: serial().primaryKey(),
		elapsedSeconds: doublePrecision(),
		createdAt: timestamptz().defaultNow().notNull(),
		level: text().notNull().$type<MigrationReportLevel>(),
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
		createdAt: timestamptz().defaultNow().notNull(),
		detail: jsonb().$type<MigrationReportDetail>().notNull(),
		reportSeq: integer()
			.notNull()
			.references(() => migrationReport.seq, { onDelete: "cascade" }),
	},
	(table) => [index("migration_report_detail_report_seq_seq_idx").on(table.reportSeq, table.seq)],
);

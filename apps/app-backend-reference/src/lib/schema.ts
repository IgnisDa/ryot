import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
	id: text().primaryKey(),
	name: text().notNull(),
	image: text(),
	email: text().notNull().unique(),
	emailVerified: boolean().default(false).notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable(
	"session",
	{
		id: text().primaryKey(),
		token: text().notNull().unique(),
		userAgent: text(),
		ipAddress: text(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("reference_session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text().primaryKey(),
		scope: text(),
		idToken: text(),
		password: text(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessToken: text(),
		refreshToken: text(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("reference_account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text().primaryKey(),
		value: text().notNull(),
		identifier: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("reference_verification_identifier_idx").on(table.identifier)],
);

export const upload = pgTable(
	"upload",
	{
		id: uuid().primaryKey().defaultRandom(),
		size: integer().notNull(),
		userId: text().notNull(),
		contents: text().notNull(),
		fileName: text().notNull(),
		contentType: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("reference_upload_user_id_idx").on(table.userId)],
);

export const audibleRun = pgTable(
	"audible_run",
	{
		id: uuid().primaryKey().defaultRandom(),
		userId: text().notNull(),
		query: text(),
		status: text().notNull(),
		uploadId: uuid(),
		executionId: text(),
		confirmationToken: text(),
		finalResult: jsonb(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("reference_audible_run_user_id_idx").on(table.userId)],
);

export const audibleItem = pgTable(
	"audible_item",
	{
		id: uuid().primaryKey().defaultRandom(),
		asin: text(),
		query: text().notNull(),
		title: text(),
		author: text(),
		status: text().notNull(),
		details: jsonb(),
		imageUrl: text(),
		sourceUrl: text(),
		runId: uuid()
			.notNull()
			.references(() => audibleRun.id, { onDelete: "cascade" }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("reference_audible_item_run_id_idx").on(table.runId),
		uniqueIndex("reference_audible_item_run_query_idx").on(table.runId, table.query),
	],
);

export const workflowStep = pgTable(
	"workflow_step",
	{
		id: uuid().primaryKey().defaultRandom(),
		name: text().notNull(),
		status: text().notNull(),
		details: jsonb(),
		runId: uuid()
			.notNull()
			.references(() => audibleRun.id, { onDelete: "cascade" }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("reference_workflow_step_run_id_idx").on(table.runId)],
);

export const sandboxRun = pgTable(
	"sandbox_run",
	{
		id: uuid().primaryKey().defaultRandom(),
		runId: uuid(),
		userId: text().notNull(),
		scriptSlug: text().notNull(),
		logs: text(),
		status: text().notNull(),
		context: jsonb(),
		driverName: text().notNull(),
		result: jsonb(),
		error: text(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("reference_sandbox_run_user_id_idx").on(table.userId)],
);

export const audibleSchedule = pgTable("audible_schedule", {
	id: uuid().primaryKey().defaultRandom(),
	enabled: boolean().default(true).notNull(),
	query: text().notNull(),
	intervalSeconds: integer().default(3600).notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

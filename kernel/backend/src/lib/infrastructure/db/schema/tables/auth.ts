import { boolean, index, integer, jsonb, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

export const user = snakeCase.table("user", {
	image: text(),
	name: text().notNull(),
	id: text().primaryKey(),
	twoFactorEnabled: boolean(),
	email: text().notNull().unique(),
	disabledAt: timestamp({ withTimezone: true }),
	emailVerified: boolean().default(false).notNull(),
	bootstrapCompletedAt: timestamp({ withTimezone: true }),
	preferences: jsonb().$type<Record<string, unknown>>().notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});
export const session = snakeCase.table(
	"session",
	{
		ipAddress: text(),
		userAgent: text(),
		id: text().primaryKey(),
		token: text().notNull().unique(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = snakeCase.table(
	"account",
	{
		scope: text(),
		idToken: text(),
		password: text(),
		accessToken: text(),
		refreshToken: text(),
		id: text().primaryKey(),
		issuer: text().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = snakeCase.table(
	"verification",
	{
		id: text().primaryKey(),
		value: text().notNull(),
		identifier: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = snakeCase.table(
	"apikey",
	{
		name: text(),
		start: text(),
		prefix: text(),
		metadata: text(),
		permissions: text(),
		remaining: integer(),
		key: text().notNull(),
		id: text().primaryKey(),
		refillAmount: integer(),
		refillInterval: integer(),
		enabled: boolean().default(true),
		requestCount: integer().default(0),
		rateLimitMax: integer().default(10),
		rateLimitEnabled: boolean().default(true),
		configId: text().default("default").notNull(),
		expiresAt: timestamp({ withTimezone: true }),
		lastRequest: timestamp({ withTimezone: true }),
		lastRefillAt: timestamp({ withTimezone: true }),
		rateLimitTimeWindow: integer().default(86400000),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
		referenceId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("apikey_configId_idx").on(table.configId),
		index("apikey_referenceId_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const twoFactor = snakeCase.table("two_factor", {
	id: text().primaryKey(),
	secret: text().notNull(),
	backupCodes: text().notNull(),
	verified: boolean().notNull(),
	failedVerificationCount: integer().default(0),
	lockedUntil: timestamp({ withTimezone: true }),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

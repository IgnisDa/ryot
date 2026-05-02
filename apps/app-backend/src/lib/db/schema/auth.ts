import { dayjs } from "@ryot/ts-utils";
import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
	image: text(),
	name: text().notNull(),
	id: text().primaryKey(),
	preferences: jsonb().notNull(),
	email: text().notNull().unique(),
	emailVerified: boolean().default(false).notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
		.notNull(),
});

export const session = pgTable(
	"session",
	{
		ipAddress: text(),
		userAgent: text(),
		id: text().primaryKey(),
		token: text().notNull().unique(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		scope: text(),
		idToken: text(),
		password: text(),
		accessToken: text(),
		refreshToken: text(),
		id: text().primaryKey(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text().primaryKey(),
		value: text().notNull(),
		identifier: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = pgTable(
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
		referenceId: text().notNull(),
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
	},
	(table) => [
		index("apikey_configId_idx").on(table.configId),
		index("apikey_referenceId_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [session.userId],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [account.userId],
	}),
}));

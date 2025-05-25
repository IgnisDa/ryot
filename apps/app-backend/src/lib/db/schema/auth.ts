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
	createdAt: timestamp().defaultNow().notNull(),
	emailVerified: boolean().default(false).notNull(),
	updatedAt: timestamp()
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
		expiresAt: timestamp().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
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
		accessTokenExpiresAt: timestamp(),
		refreshTokenExpiresAt: timestamp(),
		createdAt: timestamp().defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp()
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
		expiresAt: timestamp().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
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
		expiresAt: timestamp(),
		id: text().primaryKey(),
		refillAmount: integer(),
		lastRequest: timestamp(),
		refillInterval: integer(),
		lastRefillAt: timestamp(),
		referenceId: text().notNull(),
		createdAt: timestamp().notNull(),
		updatedAt: timestamp().notNull(),
		enabled: boolean().default(true),
		requestCount: integer().default(0),
		rateLimitMax: integer().default(10),
		rateLimitEnabled: boolean().default(true),
		configId: text().default("default").notNull(),
		rateLimitTimeWindow: integer().default(86400000),
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

import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
	image: text(),
	name: text().notNull(),
	id: text().primaryKey(),
	email: text().notNull().unique(),
	isAnonymous: boolean().default(false),
	createdAt: timestamp().defaultNow().notNull(),
	emailVerified: boolean().default(false).notNull(),
	updatedAt: timestamp()
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
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

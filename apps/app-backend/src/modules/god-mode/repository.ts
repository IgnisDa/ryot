import { asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { defaultUserPreferences } from "#lib/builtins/bootstrap";
import { CurrentDb, dbEffect, schema } from "#lib/db";

const userSearchClause = (search?: string) =>
	search ? ilike(schema.user.email, `%${search.trim()}%`) : undefined;

export class GodModeRepository extends Effect.Service<GodModeRepository>()("GodModeRepository", {
	sync: () => ({
		countUsers: (search?: string) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ count: sql<string>`count(*)` })
						.from(schema.user)
						.where(userSearchClause(search)),
				);
				return Number(rows[0]?.count ?? 0);
			}),
		listUserRows: (input: { search?: string; offset: number; limit: number }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({
							id: schema.user.id,
							name: schema.user.name,
							email: schema.user.email,
							bannedAt: schema.user.bannedAt,
							createdAt: schema.user.createdAt,
							twoFactorEnabled: schema.user.twoFactorEnabled,
						})
						.from(schema.user)
						.where(userSearchClause(input.search))
						.limit(input.limit)
						.offset(input.offset)
						.orderBy(asc(schema.user.createdAt)),
				);

				return rows.map((row) => ({
					id: row.id,
					name: row.name,
					email: row.email,
					createdAt: row.createdAt.toISOString(),
					bannedAt: row.bannedAt?.toISOString() ?? null,
					twoFactorEnabled: row.twoFactorEnabled ?? null,
				}));
			}),
		listAccountsForUsers: (userIds: string[]) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
					db
						.select({ userId: schema.account.userId, providerId: schema.account.providerId })
						.from(schema.account)
						.where(inArray(schema.account.userId, userIds)),
				);
			}),
		findUserById: (userId: string) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.user.id, email: schema.user.email })
						.from(schema.user)
						.where(eq(schema.user.id, userId))
						.limit(1),
				);
				return row ?? null;
			}),
		findUserIdByEmail: (email: string) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.user.id })
						.from(schema.user)
						.where(eq(schema.user.email, email))
						.limit(1),
				);
				return row ?? null;
			}),
		findUserBanState: (userId: string) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.user.id, bannedAt: schema.user.bannedAt })
						.from(schema.user)
						.where(eq(schema.user.id, userId))
						.limit(1),
				);
				return row ?? null;
			}),
		insertUser: (input: { id: string; name: string; email: string }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
					db.insert(schema.user).values({
						id: input.id,
						name: input.name,
						email: input.email,
						emailVerified: true,
						preferences: defaultUserPreferences,
					}),
				);
			}),
		insertOidcAccount: (input: { userId: string; oidcIssuerId: string }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
					db.insert(schema.account).values({
						providerId: "oidc",
						userId: input.userId,
						id: crypto.randomUUID(),
						accountId: input.oidcIssuerId,
					}),
				);
			}),
		updateUserBan: (input: { userId: string; bannedAt: Date | null; updatedAt: Date }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
					db
						.update(schema.user)
						.set({ bannedAt: input.bannedAt, updatedAt: input.updatedAt })
						.where(eq(schema.user.id, input.userId)),
				);
			}),
	}),
}) {}

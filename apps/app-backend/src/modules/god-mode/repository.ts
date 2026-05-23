import { asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { defaultUserPreferences } from "#lib/builtins/bootstrap";
import { CurrentDb, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/auth";
import type { UserId } from "#lib/schema/brands";

const userSearchClause = (search?: string) =>
	search ? ilike(schema.user.email, `%${search.trim()}%`) : undefined;

export class GodModeRepository extends Effect.Service<GodModeRepository>()("GodModeRepository", {
	sync: () => {
		const countUsers = Effect.fn("GodModeRepository.countUsers")(function* (search?: string) {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select({ count: sql<string>`count(*)` })
					.from(schema.user)
					.where(userSearchClause(search)),
			);
			return Number(rows[0]?.count ?? 0);
		});

		const listUserRows = Effect.fn("GodModeRepository.listUserRows")(function* (input: {
			search?: string;
			offset: number;
			limit: number;
		}) {
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
		});

		const listAccountsForUsers = Effect.fn("GodModeRepository.listAccountsForUsers")(function* (
			userIds: string[],
		) {
			const db = yield* CurrentDb;
			return yield* dbEffect(() =>
				db
					.select({ userId: schema.account.userId, providerId: schema.account.providerId })
					.from(schema.account)
					.where(inArray(schema.account.userId, userIds)),
			);
		});

		const findUserById = Effect.fn("GodModeRepository.findUserById")(function* (userId: UserId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id, email: schema.user.email })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const findUserIdByEmail = Effect.fn("GodModeRepository.findUserIdByEmail")(function* (
			email: string,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(eq(schema.user.email, email))
					.limit(1),
			);
			return row ?? null;
		});

		const findUserBanState = Effect.fn("GodModeRepository.findUserBanState")(function* (
			userId: UserId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id, bannedAt: schema.user.bannedAt })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const insertUser = Effect.fn("GodModeRepository.insertUser")(function* (input: {
			id: string;
			name: string;
			email: string;
		}) {
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
		});

		const insertOidcAccount = Effect.fn("GodModeRepository.insertOidcAccount")(function* (input: {
			userId: UserId;
			oidcIssuerId: string;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db.insert(schema.account).values({
					providerId: "oidc",
					userId: input.userId,
					id: crypto.randomUUID(),
					accountId: input.oidcIssuerId,
				}),
			);
		});

		const updateUserBan = Effect.fn("GodModeRepository.updateUserBan")(function* (input: {
			userId: UserId;
			bannedAt: Date | null;
			updatedAt: Date;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db
					.update(schema.user)
					.set({ bannedAt: input.bannedAt, updatedAt: input.updatedAt })
					.where(eq(schema.user.id, input.userId)),
			);
		});

		return {
			countUsers,
			listUserRows,
			listAccountsForUsers,
			findUserById,
			findUserIdByEmail,
			findUserBanState,
			insertUser,
			insertOidcAccount,
			updateUserBan,
		};
	},
}) {}

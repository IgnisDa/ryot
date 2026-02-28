import type { UserId } from "@ryot/contract/schema/brands";
import { asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

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
			search?: string | undefined;
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
						disabledAt: schema.user.disabledAt,
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
				disabledAt: row.disabledAt?.toISOString() ?? null,
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

		const findUserDisabledState = Effect.fn("GodModeRepository.findUserDisabledState")(function* (
			userId: UserId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id, disabledAt: schema.user.disabledAt })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const loadDeleteSnapshot = Effect.fn("GodModeRepository.loadDeleteSnapshot")(function* (
			userId: UserId,
		) {
			const db = yield* CurrentDb;
			const [user] = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			if (!user) {
				return null;
			}

			const apiKeys = yield* dbEffect(() =>
				db
					.select({ id: schema.apikey.id, key: schema.apikey.key })
					.from(schema.apikey)
					.where(eq(schema.apikey.referenceId, userId)),
			);
			return { user, apiKeys };
		});

		const loadResetSnapshot = Effect.fn("GodModeRepository.loadResetSnapshot")(function* (
			userId: UserId,
		) {
			const db = yield* CurrentDb;
			const [user] = yield* dbEffect(() =>
				db
					.select({
						id: schema.user.id,
						name: schema.user.name,
						email: schema.user.email,
						emailVerified: schema.user.emailVerified,
					})
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			if (!user) {
				return null;
			}
			const accounts = yield* dbEffect(() =>
				db
					.select({ providerId: schema.account.providerId, accountId: schema.account.accountId })
					.from(schema.account)
					.where(eq(schema.account.userId, userId)),
			);
			const apiKeys = yield* dbEffect(() =>
				db
					.select({ id: schema.apikey.id, key: schema.apikey.key })
					.from(schema.apikey)
					.where(eq(schema.apikey.referenceId, userId)),
			);
			return { user, accounts, apiKeys };
		});

		return {
			countUsers,
			listUserRows,
			findUserById,
			loadResetSnapshot,
			findUserIdByEmail,
			loadDeleteSnapshot,
			listAccountsForUsers,
			findUserDisabledState,
		};
	},
}) {}

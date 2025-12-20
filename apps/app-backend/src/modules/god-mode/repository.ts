import { asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/db/schema/tables/auth";
import { CurrentDb, dbEffect } from "#lib/db/service";
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

		const updateUserDisabled = Effect.fn("GodModeRepository.updateUserDisabled")(function* (input: {
			userId: UserId;
			disabledAt: Date | null;
			updatedAt: Date;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db
					.update(schema.user)
					.set({ disabledAt: input.disabledAt, updatedAt: input.updatedAt })
					.where(eq(schema.user.id, input.userId)),
			);
		});

		return {
			countUsers,
			listUserRows,
			findUserById,
			updateUserDisabled,
			findUserDisabledState,
			findUserIdByEmail,
			listAccountsForUsers,
		};
	},
}) {}

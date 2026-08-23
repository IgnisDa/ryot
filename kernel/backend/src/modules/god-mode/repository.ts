import type { UserId } from "@ryot-app/contract/schema/brands";
import { asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { migrationReport } from "#lib/infrastructure/db/schema/tables/migration-reports";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

const userSearchClause = (search?: string) =>
	search ? ilike(schema.user.email, `%${search.trim()}%`) : undefined;

export class GodModeRepository extends Context.Service<GodModeRepository>()("GodModeRepository", {
	make: Effect.sync(() => {
		const listMigrationReportEntries = Effect.fn("GodModeRepository.listMigrationReportEntries")(
			function* () {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(migrationReport)
						.orderBy(
							desc(sql`case when ${migrationReport.level} = 'warning' then 1 else 0 end`),
							desc(migrationReport.createdAt),
							desc(migrationReport.seq),
						),
				);

				return rows.map((row) => Object.assign(row, { createdAt: row.createdAt.toISOString() }));
			},
		);

		const countUsers = Effect.fn("GodModeRepository.countUsers")(function* (search?: string) {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ count: sql<string>`count(*)` })
					.from(schema.user)
					.where(userSearchClause(search)),
			);
			return Number(rows[0]?.count ?? 0);
		});

		const listUserRows = Effect.fn("GodModeRepository.listUserRows")(function* (input: {
			limit: number;
			offset: number;
			search?: string | undefined;
		}) {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.user.id,
						name: schema.user.name,
						email: schema.user.email,
						createdAt: schema.user.createdAt,
						disabledAt: schema.user.disabledAt,
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
				twoFactorEnabled: row.twoFactorEnabled ?? null,
				disabledAt: row.disabledAt?.toISOString() ?? null,
			}));
		});

		const listAccountsForUsers = Effect.fn("GodModeRepository.listAccountsForUsers")(function* (
			userIds: string[],
		) {
			const db = yield* Database;
			return yield* mapDatabaseErrors(
				db
					.select({ userId: schema.account.userId, providerId: schema.account.providerId })
					.from(schema.account)
					.where(inArray(schema.account.userId, userIds)),
			);
		});

		const findUserById = Effect.fn("GodModeRepository.findUserById")(function* (userId: UserId) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
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
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.user.id, disabledAt: schema.user.disabledAt })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		return {
			countUsers,
			listUserRows,
			findUserById,
			findUserIdByEmail,
			listAccountsForUsers,
			findUserDisabledState,
			listMigrationReportEntries,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

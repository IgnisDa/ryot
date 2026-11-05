import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Ref } from "effect";

import { user } from "#schema/tables/auth";
import { idempotencyKey } from "#schema/tables/mutations";
import { fakeDatabaseSession } from "#testing/effect";

export const mutationAdmissionTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const keyRows = yield* Ref.make<ReadonlyMap<string, typeof idempotencyKey.$inferInsert>>(
			new Map(),
		);
		const dialect = new PgDialect();
		return fakeDatabaseSession({
			execute: () => Effect.succeed([]),
			insert: () => ({
				values: (input: typeof idempotencyKey.$inferInsert) => ({
					onConflictDoNothing: () =>
						Ref.update(keyRows, (stored) =>
							stored.has(`${input.userId}:${input.key}`)
								? stored
								: new Map(stored).set(`${input.userId}:${input.key}`, input),
						),
				}),
			}),
			select: () => ({
				from: (table: unknown) => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
						const rows = (() => {
							if (table === user) {
								return Effect.succeed([{ token: "test-account-generation" }]);
							}
							if (table !== idempotencyKey) {
								return Effect.succeed([]);
							}
							const [userId, key] = dialect.sqlToQuery(condition).params;
							return Effect.map(Ref.get(keyRows), (stored) => {
								const row = stored.get(`${String(userId)}:${String(key)}`);
								return row ? [row] : [];
							});
						})();
						return Object.assign(rows, { for: () => rows, limit: () => rows });
					},
				}),
			}),
		});
	}),
);

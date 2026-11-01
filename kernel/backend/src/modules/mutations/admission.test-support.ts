import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Ref } from "effect";

import { user } from "#schema/tables/auth";
import { mutationReceipt } from "#schema/tables/mutations";
import { fakeDatabaseSession } from "#testing/effect";

export const mutationAdmissionTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fingerprints = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const receiptRows = yield* Ref.make<Map<string, typeof mutationReceipt.$inferInsert>>(
			new Map(),
		);
		const dialect = new PgDialect();
		return fakeDatabaseSession({
			execute: (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
				const [id] = dialect.sqlToQuery(query).params;
				return Ref.get(fingerprints).pipe(
					Effect.map((stored) => [
						{
							retiring: false,
							fingerprint: typeof id === "string" ? (stored.get(id) ?? null) : null,
						},
					]),
				);
			},
			insert: () => ({
				values: (input: typeof mutationReceipt.$inferInsert) =>
					Object.assign(
						Ref.update(receiptRows, (stored) => new Map(stored).set(input.id, input)),
						{
							onConflictDoNothing: () => ({
								returning: () =>
									Ref.modify(fingerprints, (stored) =>
										stored.has(input.id)
											? [[], stored]
											: [
													[{ fingerprint: input.inputFingerprint }],
													new Map(stored).set(input.id, input.inputFingerprint),
												],
									),
							}),
						},
					),
			}),
			select: () => ({
				from: (table: unknown) => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
						const rows = (() => {
							if (table === user) {
								return Effect.succeed([{ token: "test-account-generation" }]);
							}
							if (table !== mutationReceipt) {
								return Effect.succeed([]);
							}
							const [id] = dialect.sqlToQuery(condition).params;
							return Effect.map(Ref.get(receiptRows), (stored) => {
								const row = typeof id === "string" ? stored.get(id) : undefined;
								return row?.receiptType === "item" ? [row] : [];
							});
						})();
						return Object.assign(rows, { for: () => rows, limit: () => rows });
					},
				}),
			}),
		});
	}),
);

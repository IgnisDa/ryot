import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Ref } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import type { mutationReceipt } from "#lib/infrastructure/db/schema/tables/mutations";

import { fakeDatabaseSession } from "./effect";

export const mutationAdmissionTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fingerprints = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
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
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						const rows = (() => {
							if (table === user) {
								return Effect.succeed([{ token: "test-account-generation" }]);
							}
							return Effect.succeed([]);
						})();
						return Object.assign(rows, { for: () => rows, limit: () => rows });
					},
				}),
			}),
			insert: () => ({
				values: (input: Pick<typeof mutationReceipt.$inferInsert, "id" | "inputFingerprint">) => ({
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
				}),
			}),
		});
	}),
);

import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Ref } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { mutationReceipt } from "#lib/infrastructure/db/schema/tables/mutations";

import { fakeDatabaseSession } from "./effect";

export const mutationAdmissionTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fingerprints = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const dialect = new PgDialect();
		return fakeDatabaseSession({
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
			select: (fields?: Readonly<Record<string, unknown>>) => ({
				from: (table: unknown) => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
						const rows = (() => {
							if (table === user) {
								return Effect.succeed([{ token: "test-account-generation" }]);
							}
							if (table === mutationReceipt && fields && "fingerprint" in fields) {
								const [id] = dialect.sqlToQuery(condition).params;
								return Ref.get(fingerprints).pipe(
									Effect.map((stored) => {
										const value = typeof id === "string" ? stored.get(id) : undefined;
										return value === undefined ? [] : [{ fingerprint: value }];
									}),
								);
							}
							return Effect.succeed([]);
						})();
						return Object.assign(rows, { for: () => rows, limit: () => rows });
					},
				}),
			}),
		});
	}),
);

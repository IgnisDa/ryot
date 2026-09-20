import { Effect, Layer, Ref } from "effect";

import { user } from "#lib/infrastructure/db/schema/tables/auth";

import { fakeDatabaseSession } from "./effect";

export const mutationAdmissionTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fingerprint = yield* Ref.make<string | undefined>(undefined);
		return fakeDatabaseSession({
			insert: () => ({
				values: (input: { readonly inputFingerprint: string }) => ({
					onConflictDoNothing: () => Ref.set(fingerprint, input.inputFingerprint),
				}),
			}),
			select: (fields?: Readonly<Record<string, unknown>>) => ({
				from: (table: unknown) => ({
					where: () => {
						const rows = (() => {
							if (table === user) {
								return Effect.succeed([{ token: "test-account-generation" }]);
							}
							if (fields && "fingerprint" in fields) {
								return Ref.get(fingerprint).pipe(Effect.map((value) => [{ fingerprint: value }]));
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

import { Effect, Option, Ref } from "effect";

import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect } from "#lib/db/service";
import { dieOnDbError } from "#lib/errors";

const readCanonicalByScript = Effect.gen(function* () {
	const db = yield* CurrentDb;
	const rows = yield* dbEffect(() =>
		db
			.select({ id: schema.sandboxScript.id, metadata: schema.sandboxScript.metadata })
			.from(schema.sandboxScript),
	);
	const map: Record<string, string> = {};
	for (const row of rows) {
		const canonicalLanguage = row.metadata.providerInformation?.canonicalLanguage;
		if (canonicalLanguage) {
			map[row.id] = canonicalLanguage;
		}
	}
	return map;
});

// Canonical language per sandbox script (`{ scriptId -> canonicalLanguage }`), consulted by the query
// engine's `translationStatus` computed field. Reading eagerly at construction is not viable: the query
// engine — and thus this service — is built as a runtime dependency before the migrate/seed chain runs,
// so the table is not yet seeded. Builtins are boot-immutable, so the map is read lazily on first use
// (always post-seed) and the SUCCESS is memoized. A transient failure is deliberately not cached, so a
// blip on the first localized query cannot poison every later query until a restart.
export class ProviderConfig extends Effect.Service<ProviderConfig>()("ProviderConfig", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const cache = yield* Ref.make(Option.none<Record<string, string>>());
		const canonicalByScript = Ref.get(cache).pipe(
			Effect.flatMap(
				Option.match({
					onSome: Effect.succeed,
					onNone: () =>
						runWithDb(readCanonicalByScript).pipe(
							Effect.tap((map) => Ref.set(cache, Option.some(map))),
							dieOnDbError,
						),
				}),
			),
		);
		return { canonicalByScript };
	}),
}) {}

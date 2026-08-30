import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { inject } from "vitest";

import { DatabaseSession } from "#lib/infrastructure/db/session";

export const testDatabaseUrl = () => inject("databaseUrl");

export const withIsolatedDatabase = <A, E, R>(
	name: string,
	url: string,
	use: (isolatedUrl: string) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const db = yield* (yield* DatabaseSession).current;
		return yield* Effect.acquireUseRelease(
			db.execute(sql`create database ${sql.identifier(name)}`),
			() => use(new URL(`/${name}`, url).toString()),
			() => db.execute(sql`drop database ${sql.identifier(name)}`).pipe(Effect.orDie),
		);
	});

declare module "vitest" {
	interface ProvidedContext {
		databaseUrl: string;
	}
}

import { BunCrypto } from "@effect/platform-bun";
import type { PgClient } from "@effect/sql-pg";
import { randomUuid } from "@ryot-app/testing/random";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import {
	dropTestDatabase,
	testDatabaseTemplate,
	testDatabaseUrlFor,
	testPgClientLayer,
} from "#testing/database";
import { databaseLayer } from "#testing/effect";

export class IsolatedDatabase extends Context.Service<IsolatedDatabase, { readonly url: string }>()(
	"@ryot-app/kernel-backend/testing/isolated-database/IsolatedDatabase",
) {}

// The drop is registered before the isolated pool is built, so it runs after that pool closes.
export const isolatedDatabaseLayer = (
	prefix: string,
	pool: Omit<PgClient.PgPoolConfig, "url"> = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const name = `${prefix}_${(yield* randomUuid).replaceAll("-", "")}`;
			const template = yield* testDatabaseTemplate;
			const session = yield* DatabaseSession;
			yield* session.run((admin) =>
				Effect.acquireRelease(
					admin.execute(
						sql`create database ${sql.identifier(name)} template ${sql.identifier(template)}`,
					),
					() => dropTestDatabase(name).pipe(Effect.orDie),
				),
			);
			const url = yield* testDatabaseUrlFor(name);
			return Layer.effect(DatabaseSession, DatabaseSession.make).pipe(
				Layer.provideMerge(testPgClientLayer({ ...pool, database: name })),
				Layer.fresh,
				Layer.provideMerge(Layer.succeed(IsolatedDatabase, { url })),
			);
		}),
	).pipe(Layer.provide(databaseLayer), Layer.provideMerge(BunCrypto.layerSecureRandom));

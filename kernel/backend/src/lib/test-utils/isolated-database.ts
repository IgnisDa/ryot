import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Redacted } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { databaseLayer, makeAppConfigLayer } from "#lib/test-utils/effect";

export class IsolatedDatabase extends Context.Service<IsolatedDatabase, { readonly url: string }>()(
	"test/IsolatedDatabase",
) {}

// The drop is registered before the isolated pool is built, so it runs after that pool closes.
export const isolatedDatabaseLayer = (prefix: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const name = `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
			const admin = yield* (yield* DatabaseSession).current;
			yield* Effect.acquireRelease(
				admin.execute(sql`create database ${sql.identifier(name)}`),
				() =>
					admin.execute(sql`drop database ${sql.identifier(name)} with (force)`).pipe(Effect.orDie),
			);
			const url = new URL(`/${name}`, testDatabaseUrl()).toString();
			const statements = yield* baselineMigrationStatements();
			const migrated = Layer.effectDiscard(
				Effect.gen(function* () {
					const db = yield* (yield* DatabaseSession).current;
					yield* applyBaselineMigration(statements, (statement) => db.execute(sql.raw(statement)));
				}),
			);
			return migrated.pipe(
				Layer.provideMerge(
					DatabaseSession.layer.pipe(
						Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
						Layer.fresh,
					),
				),
				Layer.provideMerge(Layer.succeed(IsolatedDatabase, { url })),
			);
		}),
	).pipe(Layer.provide(databaseLayer));

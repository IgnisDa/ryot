import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Data, Effect, Layer, Redacted } from "effect";
import { assert } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";

import { ProviderImportAdmissionRepository } from "./admission-repository";

class RollbackTestSchema extends Data.TaggedError("RollbackTestSchema") {}

export const alice = UserId.make("alice");
export const bob = UserId.make("bob");

export const withAdmissionDatabase = <E>(
	test: Effect.Effect<void, E, DatabaseSession | ProviderImportAdmissionRepository>,
) => {
	const name = `admission_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const config = makeAppConfigLayer({ database: { url: Redacted.make(testDatabaseUrl()) } });
	return Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.tryPromise({
			try: () => Bun.file(directory + paths[0]).text(),
			catch: () => new DbError({ message: "Cannot read generated baseline" }),
		});
		yield* session
			.transaction(
				Effect.gen(function* () {
					const db = yield* session.current;
					yield* db.execute(sql`create schema ${sql.identifier(name)}`);
					yield* db.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
					for (const statement of ddl.split("--> statement-breakpoint")) {
						yield* db.execute(sql.raw(statement));
					}
					yield* db.insert(tables.user).values([
						{ id: alice, name: "Alice", preferences: {}, email: "alice@example.test" },
						{ id: bob, name: "Bob", preferences: {}, email: "bob@example.test" },
					]);
					yield* test;
					return yield* new RollbackTestSchema();
				}),
			)
			.pipe(Effect.catchTag("RollbackTestSchema", () => Effect.void));
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				ProviderImportAdmissionRepository.layer.pipe(
					Layer.provideMerge(DatabaseSession.layer.pipe(Layer.provide(config))),
				),
				makeConfigProviderLayer(),
			),
		),
	);
};

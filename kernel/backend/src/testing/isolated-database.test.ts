import { expect } from "bun:test";

import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";

import { dropTestDatabase, TestDatabaseOwnershipError, testDatabaseTemplate } from "./database";
import { databaseLayer } from "./effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "./isolated-database";

layer(databaseLayer)((test) => {
	test.effect("drops the current file's isolated database after its scoped pools close", () =>
		Effect.gen(function* () {
			const name = yield* Effect.scoped(
				Effect.gen(function* () {
					const services = yield* Layer.build(isolatedDatabaseLayer("scoped_cleanup"));
					const isolated = Context.get(services, IsolatedDatabase);
					const session = Context.get(services, DatabaseSession);
					yield* session.run((db) => db.execute(sql`select 1`));
					return new URL(isolated.url).pathname.slice(1);
				}),
			);
			const session = yield* DatabaseSession;
			const remaining = yield* session.run((db) =>
				db.execute(sql`select datname from pg_database where datname = ${name}`, "objects"),
			);
			expect(remaining).toEqual([]);
		}),
	);

	test.effect(
		"refuses administrator cleanup of a database outside the current file's ownership",
		() =>
			Effect.gen(function* () {
				const template = yield* testDatabaseTemplate;
				assertExitFails(
					yield* Effect.exit(dropTestDatabase(template)),
					new TestDatabaseOwnershipError({ database: template }),
				);
				const session = yield* DatabaseSession;
				const remaining = yield* session.run((db) =>
					db.execute(sql`select datname from pg_database where datname = ${template}`, "objects"),
				);
				expect(remaining).toHaveLength(1);
			}),
	);
});

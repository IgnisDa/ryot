import { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";

import { ProviderImportAdmissionRepository } from "./admission-repository";

export const alice = UserId.make("alice");
export const bob = UserId.make("bob");

/** The connection's search path points at a private schema, so code under test owns its transactions. */
export const admissionDatabaseLayer = Layer.unwrap(
	Effect.sync(() => {
		const name = `admission_test_${crypto.randomUUID().replaceAll("-", "")}`;
		const databaseUrl = new URL(testDatabaseUrl());
		const options = databaseUrl.searchParams.get("options");
		databaseUrl.searchParams.set(
			"options",
			`${options ? `${options} ` : ""}-c search_path=${name},public`,
		);
		const config = makeAppConfigLayer({
			database: { poolMax: 1, url: Redacted.make(databaseUrl.href) },
		});
		const schema = Layer.effectDiscard(
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const statements = yield* baselineMigrationStatements();
				yield* session.run((db) =>
					Effect.acquireRelease(db.execute(sql`create schema ${sql.identifier(name)}`), () =>
						db.execute(sql`drop schema ${sql.identifier(name)} cascade`).pipe(Effect.orDie),
					),
				);
				yield* session.transaction(
					session.run((transaction) =>
						Effect.gen(function* () {
							yield* applyBaselineMigration(statements, (statement) =>
								transaction.execute(sql.raw(statement)),
							);
							yield* transaction.insert(tables.user).values([
								{
									id: alice,
									name: "Alice",
									email: "alice@example.test",
									accountGeneration: "test-account-generation",
								},
								{
									id: bob,
									name: "Bob",
									email: "bob@example.test",
									accountGeneration: "test-account-generation",
								},
							]);
						}),
					),
				);
			}),
		);
		return Layer.mergeAll(
			schema.pipe(Layer.provideMerge(ProviderImportAdmissionRepository.layer)),
			makeConfigProviderLayer(),
		).pipe(Layer.provideMerge(DatabaseSession.layer), Layer.provide(config));
	}),
);

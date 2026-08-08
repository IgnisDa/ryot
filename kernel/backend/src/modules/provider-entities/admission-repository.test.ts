import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Data, Effect, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";

import { ProviderImportAdmissionRepository } from "./admission-repository";

class RollbackTestSchema extends Data.TaggedError("RollbackTestSchema") {}

const alice = UserId.make("alice");
const bob = UserId.make("bob");

const withAdmissionDatabase = <E>(
	test: Effect.Effect<void, E, Database | ProviderImportAdmissionRepository>,
) => {
	const name = `admission_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const config = makeAppConfigLayer({ database: { url: Redacted.make(testDatabaseUrl()) } });
	return Effect.gen(function* () {
		const db = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.tryPromise({
			try: () => Bun.file(directory + paths[0]).text(),
			catch: () => new DbError({ message: "Cannot read generated baseline" }),
		});
		yield* db
			.transaction((transaction) =>
				Effect.gen(function* () {
					yield* transaction.execute(sql`create schema ${sql.identifier(name)}`);
					yield* transaction.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
					for (const statement of ddl.split("--> statement-breakpoint")) {
						yield* transaction.execute(sql.raw(statement));
					}
					yield* transaction.insert(tables.user).values([
						{ id: alice, name: "Alice", preferences: {}, email: "alice@example.test" },
						{ id: bob, name: "Bob", preferences: {}, email: "bob@example.test" },
					]);
					yield* test;
					return yield* new RollbackTestSchema();
				}).pipe(Effect.provideService(Database, transaction)),
			)
			.pipe(Effect.catchTag("RollbackTestSchema", () => Effect.void));
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				ProviderImportAdmissionRepository.layer,
				DatabaseLive.pipe(Layer.provide(config)),
				makeConfigProviderLayer(),
			),
		),
	);
};

const request = (id: string, userId: UserId, externalId = id, backlogLimit = 50) =>
	Effect.flatMap(ProviderImportAdmissionRepository, (repository) =>
		repository.enqueue({
			id,
			userId,
			externalId,
			backlogLimit,
			payload: { id },
			providerId: "provider",
			entitySchemaSlug: "book",
		}),
	);

const admittedIds = (limit: number) =>
	Effect.flatMap(ProviderImportAdmissionRepository, (repository) => repository.admit(limit)).pipe(
		Effect.map((rows) => rows.map(({ id }) => id).sort()),
	);

/** Distinct creation times make the oldest-first tie break deterministic. */
const enqueueInOrder = (requests: ReadonlyArray<readonly [string, UserId]>) =>
	Effect.forEach(requests, ([id, userId], index) =>
		request(id, userId).pipe(
			Effect.andThen(
				Effect.flatMap(Database, (db) =>
					db.execute(
						sql`update provider_import_admission set created_at = to_timestamp(${index}) where id = ${id}`,
					),
				),
			),
		),
	);

describe("provider import admission ledger", () => {
	it.effect("gives a free slot to the user with the fewest running imports", () =>
		withAdmissionDatabase(
			Effect.gen(function* () {
				const repository = yield* ProviderImportAdmissionRepository;
				yield* enqueueInOrder([
					["a1", alice],
					["a2", alice],
					["a3", alice],
					["b1", bob],
				]);

				expect(yield* admittedIds(2)).toEqual(["a1", "b1"]);
				expect(yield* admittedIds(2)).toEqual([]);

				yield* repository.removeRunning(["b1"]);
				expect(yield* admittedIds(2)).toEqual(["a2"]);
				expect((yield* repository.listRunning()).map(({ id }) => id).sort()).toEqual(["a1", "a2"]);
			}),
		),
	);

	it.effect("returns the pending job for a repeated request and bounds each user's backlog", () =>
		withAdmissionDatabase(
			Effect.gen(function* () {
				expect(yield* request("first", alice, "book-1")).toEqual({ id: "first", status: "queued" });
				expect(yield* request("second", alice, "book-1")).toEqual({
					id: "first",
					status: "duplicate",
				});
				expect(yield* request("third", alice, "book-2", 2)).toEqual({
					id: "third",
					status: "queued",
				});
				expect(yield* request("fourth", alice, "book-3", 2)).toEqual({ status: "backlog-full" });
				expect(yield* request("other", bob, "book-3", 2)).toEqual({
					id: "other",
					status: "queued",
				});
			}),
		),
	);

	it.effect("cancels only a request that has not been admitted", () =>
		withAdmissionDatabase(
			Effect.gen(function* () {
				const repository = yield* ProviderImportAdmissionRepository;
				yield* enqueueInOrder([
					["running", alice],
					["queued", alice],
				]);
				expect(yield* admittedIds(1)).toEqual(["running"]);

				expect(yield* repository.cancelQueued({ id: "running", userId: alice })).toBe(false);
				expect(yield* repository.cancelQueued({ userId: bob, id: "queued" })).toBe(false);
				expect(yield* repository.cancelQueued({ id: "queued", userId: alice })).toBe(true);
				expect(yield* repository.find({ id: "queued", userId: alice })).toBeNull();
				expect(yield* repository.find({ id: "running", userId: alice })).toEqual({
					status: "running",
				});
			}),
		),
	);
});

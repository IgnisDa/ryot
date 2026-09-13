import { expect, it } from "@effect/vitest";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe } from "vitest";

import { Database } from "#lib/infrastructure/db/service";

import { ProviderImportAdmissionRepository } from "./admission-repository";
import { alice, bob, withAdmissionDatabase } from "./admission.test-support";

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

const admittedIds = (limit: number, finished: ReadonlyArray<string> = []) =>
	Effect.flatMap(ProviderImportAdmissionRepository, (repository) =>
		repository.admit({ limit, finished }),
	).pipe(Effect.map((rows) => rows.map(({ id }) => id).sort()));

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

				expect(yield* admittedIds(2, ["b1"])).toEqual(["a2"]);
				expect((yield* repository.listRunning()).map(({ id }) => id).sort()).toEqual(["a1", "a2"]);
			}),
		),
	);

	it.effect("gives the only slot a finishing import frees to another waiting user", () =>
		withAdmissionDatabase(
			Effect.gen(function* () {
				yield* enqueueInOrder([
					["a1", alice],
					["a2", alice],
					["b1", bob],
				]);
				expect(yield* admittedIds(1)).toEqual(["a1"]);

				expect(yield* admittedIds(1, ["a1"])).toEqual(["b1"]);
				expect(yield* admittedIds(1, ["b1"])).toEqual(["a2"]);
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

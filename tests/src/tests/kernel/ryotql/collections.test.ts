import { buildAllCollectionsDocument } from "@ryot/ryotql-recipes/collections";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	executeRyotQL,
	postBackendJson,
	requireRows,
	requireRyotQLTextField,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("RyotQL collections tracer", () => {
	it.live("returns only the authenticated user's collections as named paginated rows", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const collections = yield* Effect.all([
				createCollection(first.client, { name: "RyotQL Collection One" }),
				createCollection(first.client, { name: "RyotQL Collection Two" }),
			]);
			yield* createCollection(second.client, { name: "Another User Collection" });

			const result = yield* executeRyotQL(first.client, buildAllCollectionsDocument({ limit: 10 }));
			const rows = requireRows(result.data["collections"], "collections");

			expect(rows.pageInfo).toEqual({ limit: 10, hasMore: false, nextCursor: null });
			expect(rows.items.map((item) => requireRyotQLTextField(item, "id"))).toEqual(
				expect.arrayContaining(collections.map((collection) => collection.id)),
			);
			expect(rows.items.map((item) => requireRyotQLTextField(item, "name"))).toEqual([
				"RyotQL Collection One",
				"RyotQL Collection Two",
			]);
		}),
	);

	it.live("returns the final page after a cursor", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* Effect.all([
				createCollection(client, { name: "RyotQL Total One" }),
				createCollection(client, { name: "RyotQL Total Two" }),
			]);

			const first = yield* executeRyotQL(client, buildAllCollectionsDocument({ limit: 1 }));
			const firstRows = requireRows(first.data["collections"], "collections");
			expect(firstRows.pageInfo.nextCursor).not.toBeNull();
			const second = yield* executeRyotQL(
				client,
				buildAllCollectionsDocument({
					after: firstRows.pageInfo.nextCursor ?? undefined,
					limit: 1,
				}),
			);
			const secondRows = requireRows(second.data["collections"], "collections");
			expect(secondRows.pageInfo).toEqual({ limit: 1, hasMore: false, nextCursor: null });
			expect(secondRows.items.map((item) => requireRyotQLTextField(item, "name"))).toEqual([
				"RyotQL Total Two",
			]);
		}),
	);

	it.live("requires authentication", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				postBackendJson("/ryotql/execute", buildAllCollectionsDocument()),
			);

			expect(response.status).toBe(401);
		}),
	);
});

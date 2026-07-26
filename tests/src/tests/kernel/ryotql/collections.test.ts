import { buildAllCollectionsDocument } from "@ryot/ryotql-recipes/collections";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	executeRyotQL,
	postBackendJson,
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

			const result = yield* executeRyotQL(
				first.client,
				buildAllCollectionsDocument({ page: 1, limit: 10 }),
			);
			const rows = result.data["collections"];
			if (rows?.type !== "rows") {
				throw new Error("Expected collections result");
			}

			expect(rows.pageInfo).toEqual({ page: 1, limit: 10, total: 2, hasMore: false });
			expect(rows.items.map((item) => requireRyotQLTextField(item, "id"))).toEqual(
				expect.arrayContaining(collections.map((collection) => collection.id)),
			);
			expect(rows.items.map((item) => requireRyotQLTextField(item, "name"))).toEqual([
				"RyotQL Collection One",
				"RyotQL Collection Two",
			]);
		}),
	);

	it.live("reports the true total for a page beyond the final row", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* Effect.all([
				createCollection(client, { name: "RyotQL Total One" }),
				createCollection(client, { name: "RyotQL Total Two" }),
			]);

			const result = yield* executeRyotQL(
				client,
				buildAllCollectionsDocument({ page: 3, limit: 1 }),
			);

			expect(result.data["collections"]).toEqual({
				items: [],
				type: "rows",
				pageInfo: { page: 3, limit: 1, total: 2, hasMore: false },
			});
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

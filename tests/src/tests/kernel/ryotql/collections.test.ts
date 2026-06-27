import { allCollectionsRecipe } from "@ryot/ryotql-recipes/collections";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	executeRyotQLRecipe,
	postBackendJson,
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

			const result = yield* executeRyotQLRecipe(first.client, allCollectionsRecipe({ limit: 10 }));

			expect(result.pageInfo).toEqual({ limit: 10, hasMore: false, nextCursor: null });
			expect(result.items.map((item) => item.id)).toEqual(
				expect.arrayContaining(collections.map((collection) => collection.id)),
			);
			expect(result.items.map((item) => item.name)).toEqual([
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

			const first = yield* executeRyotQLRecipe(client, allCollectionsRecipe({ limit: 1 }));
			expect(first.pageInfo.nextCursor).not.toBeNull();
			const second = yield* executeRyotQLRecipe(
				client,
				allCollectionsRecipe({
					after: first.pageInfo.nextCursor ?? undefined,
					limit: 1,
				}),
			);
			expect(second.pageInfo).toEqual({ limit: 1, hasMore: false, nextCursor: null });
			expect(second.items.map((item) => item.name)).toEqual(["RyotQL Total Two"]);
		}),
	);

	it.live("requires authentication", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				postBackendJson("/ryotql/execute", allCollectionsRecipe().document),
			);

			expect(response.status).toBe(401);
		}),
	);
});

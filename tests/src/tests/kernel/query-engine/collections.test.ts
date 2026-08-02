import { buildAllCollectionsQueryDocument } from "@ryot/query-engine/recipes/app";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	executeQueryEngine,
	requireQueryEngineFieldValue,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("all collections query recipe", () => {
	it.live("returns the authenticated user's collections as paginated rows", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collections = yield* Effect.all([
				createCollection(client, { name: "E2E Collection One" }),
				createCollection(client, { name: "E2E Collection Two" }),
				createCollection(client, { name: "E2E Collection Three" }),
			]);

			const result = yield* executeQueryEngine(
				client,
				buildAllCollectionsQueryDocument({ page: 1, limit: 10 }),
			);

			expect(result.type).toBe("rows");
			expect(result.data.pageInfo).toMatchObject({
				page: 1,
				limit: 10,
				hasMore: false,
			});
			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "id").value),
			).toEqual(expect.arrayContaining(collections.map((collection) => collection.id)));
			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value),
			).toEqual(expect.arrayContaining(collections.map((collection) => collection.name)));
		}),
	);
});

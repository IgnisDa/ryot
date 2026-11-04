import { expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-client-sdk/effect";
import { assert } from "@ryot-app/testing/assert";

import { fixtureCollectionChoicesRecipe } from "./query-recipes";

it("restricts collection choices to the kernel collection schema", () => {
	const recipe = fixtureCollectionChoicesRecipe();
	const query = recipe.document.queries.collections;
	assert(query);

	expect(query.where).toMatchObject({
		type: "and",
		predicates: [
			{ right: { value: "collection" }, left: { field: "entitySchemaSlug" } },
			{ type: "isNull", expr: { field: "entitySchemaPluginId" } },
		],
	});
	expect(
		Result.getOrThrow(
			recipe.decode({
				data: {
					collections: {
						type: "rows",
						items: [{ name: "Favorites", id: "collection-1" }],
						pageInfo: { limit: 100, hasMore: false, nextCursor: null },
					},
				},
			}),
		),
	).toEqual([{ name: "Favorites", id: "collection-1" }]);
});

import { Result } from "@ryot-app/client-sdk/effect";
import { assert, expect, it } from "vitest";

import { fixtureCollectionChoicesRecipe } from "./query-recipes";

it("restricts collection choices to the kernel collection schema", () => {
	const recipe = fixtureCollectionChoicesRecipe();
	const query = recipe.document.queries.collections;
	assert(query);

	expect(query.where).toMatchObject({
		predicates: [
			{ left: { field: "entitySchemaSlug" }, right: { value: "collection" } },
			{ expr: { field: "entitySchemaPluginId" }, type: "isNull" },
		],
		type: "and",
	});
	expect(
		Result.getOrThrow(
			recipe.decode({
				data: {
					collections: {
						type: "rows",
						items: [{ id: "collection-1", name: "Favorites" }],
						pageInfo: { hasMore: false, limit: 100, nextCursor: null },
					},
				},
			}),
		),
	).toEqual([{ id: "collection-1", name: "Favorites" }]);
});

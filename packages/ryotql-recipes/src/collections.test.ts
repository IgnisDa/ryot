import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { allCollectionsRecipe } from "./collections";

const pageInfo = { limit: 7, hasMore: false, nextCursor: null };

describe("collections recipe", () => {
	it("prepares and decodes the paginated collection list", () => {
		const recipe = allCollectionsRecipe({ limit: 7, after: "cursor" });
		const query = recipe.document.queries.collections;
		assert(query);

		expect(query.output).toMatchObject({
			fields: [{ key: "id" }, { key: "name" }],
			pagination: { limit: 7, after: "cursor" },
		});
		expect(query.where).toMatchObject({ right: { value: "collection" } });
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						collections: {
							pageInfo,
							type: "rows",
							items: [{ name: "Favorites", id: "collection-1" }],
						},
					},
				}),
			),
		).toEqual({ pageInfo, items: [{ name: "Favorites", id: "collection-1" }] });
	});

	it("rejects malformed fields and result cardinality", () => {
		const recipe = allCollectionsRecipe();
		expect(
			Result.isFailure(
				recipe.decode({
					data: { collections: { pageInfo, type: "rows", items: [{ id: 1, name: "Bad" }] } },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { collections: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});

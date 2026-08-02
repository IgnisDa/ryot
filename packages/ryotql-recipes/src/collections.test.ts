import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { allCollectionsRecipe } from "./collections";

const pageInfo = { hasMore: false, limit: 7, nextCursor: null };

describe("collections recipe", () => {
	it("prepares and decodes the paginated collection list", () => {
		const recipe = allCollectionsRecipe({ after: "cursor", limit: 7 });
		const query = recipe.document.queries.collections;
		assert(query);

		expect(query.output).toMatchObject({
			pagination: { after: "cursor", limit: 7 },
			fields: [{ key: "id" }, { key: "name" }],
		});
		expect(query.where).toMatchObject({ right: { value: "collection" } });
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						collections: {
							pageInfo,
							type: "rows",
							items: [{ id: "collection-1", name: "Favorites" }],
						},
					},
				}),
			),
		).toEqual({ items: [{ id: "collection-1", name: "Favorites" }], pageInfo });
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

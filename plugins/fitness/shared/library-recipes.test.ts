import { expect, it } from "vitest";

import { userFitnessLibraryRecipe } from "./library-recipes";

it("selects the user-owned fitness library and rejects a missing row", () => {
	const recipe = userFitnessLibraryRecipe();
	expect(recipe.document.queries.fitnessLibrary?.where).toEqual({
		type: "and",
		predicates: [
			{
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "fitness-library" },
				left: { type: "column", field: "entitySchemaSlug", tableAlias: "fitnessLibrary" },
			},
			{
				type: "isNotNull",
				expr: { type: "column", field: "userId", tableAlias: "fitnessLibrary" },
			},
		],
	});
	expect(
		recipe.decode({
			data: {
				fitnessLibrary: {
					items: [],
					type: "rows",
					pageInfo: { limit: 2, hasMore: false, nextCursor: null },
				},
			},
		})._tag,
	).toBe("Failure");
});

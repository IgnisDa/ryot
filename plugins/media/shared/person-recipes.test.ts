import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { personRecipes } from "./person-recipes";

const rowsOutput = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output;
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowsOutput(recipe, name).fields.map((field) => ("key" in field ? field.key : null));

const movieCreditKeys = (recipe: PreparedRecipe<unknown>) =>
	rowsOutput(recipe, "credits")
		.include?.find(({ key }) => key === "movie")
		?.fields.map((field) => ("key" in field ? field.key : null));

describe("media person query recipes", () => {
	it("selects the biography fields the person schema declares", () => {
		expect(
			keys(
				personRecipes.summaryRecipe({ collectionLimit: 6, entityId: "person-1" }),
				"summary",
			).slice(-7),
		).toEqual([
			"alternateNames",
			"birthDate",
			"deathDate",
			"birthPlace",
			"gender",
			"website",
			"sourceUrl",
		]);
	});

	it("carries the character on media credits", () => {
		expect(
			movieCreditKeys(personRecipes.overviewRecipe({ creditLimit: 12, entityId: "person-1" })),
		).toContain("character");
	});
});

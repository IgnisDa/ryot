import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { companyRecipes } from "./company-recipes";

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

describe("media company query recipes", () => {
	it("selects the founding and headquarters fields the company schema declares", () => {
		expect(
			keys(
				companyRecipes.summaryRecipe({ collectionLimit: 6, entityId: "company-1" }),
				"summary",
			).slice(-5),
		).toEqual(["alternateNames", "foundedYear", "headquarters", "website", "sourceUrl"]);
	});

	it("carries no character on credits", () => {
		expect(
			movieCreditKeys(companyRecipes.overviewRecipe({ creditLimit: 12, entityId: "company-1" })),
		).not.toContain("character");
	});
});

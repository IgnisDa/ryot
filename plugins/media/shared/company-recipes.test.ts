import { describe, expect, it } from "bun:test";

import type { RyotQLDocument as ImportedRyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { companyRecipes } from "./company-recipes";

const rowsOutput = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output;
};
const keys = (
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<unknown, AppSchema>["decode"] },
	name: string,
) => rowsOutput(recipe, name).fields.map((field) => ("key" in field ? field.key : null));
const movieCreditKeys = (recipe: {
	document: ImportedRyotQLDocument;
	decode: Recipe<unknown, AppSchema>["decode"];
}) =>
	rowsOutput(recipe, "credits")
		.include?.find(({ key }) => key === "movie")
		?.fields.map((field) => ("key" in field ? field.key : null));

describe("media company query recipes", () => {
	it("selects the founding and headquarters fields the company schema declares", () => {
		expect(
			keys(
				bindRecipe(companyRecipes.summaryRecipe({ reference: { kind: "self" } }), {
					entityId: "company-1",
				}),
				"summary",
			).slice(-5),
		).toEqual(["alternateNames", "website", "sourceUrl", "foundedYear", "headquarters"]);
	});

	it("carries no character on credits", () => {
		expect(
			movieCreditKeys(
				bindRecipe(companyRecipes.overviewRecipe({ reference: { kind: "self" } }), {
					entityId: "company-1",
				}),
			),
		).not.toContain("character");
	});
});

import { describe, expect, it } from "bun:test";

import type { RyotQLDocument as ImportedRyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { personRecipes } from "./person-recipes";

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

describe("media person query recipes", () => {
	it("selects the biography fields the person schema declares", () => {
		expect(
			keys(
				bindRecipe(personRecipes.summaryRecipe({ reference: { kind: "self" } }), {
					entityId: "person-1",
				}),
				"summary",
			).slice(-7),
		).toEqual([
			"alternateNames",
			"gender",
			"website",
			"birthDate",
			"deathDate",
			"sourceUrl",
			"birthPlace",
		]);
	});

	it("carries the character on media credits", () => {
		expect(
			movieCreditKeys(
				bindRecipe(personRecipes.overviewRecipe({ reference: { kind: "self" } }), {
					entityId: "person-1",
				}),
			),
		).toContain("character");
	});
});

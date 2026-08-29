import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { comicBookRecipes } from "./comic-book-recipes";

const rowFields = (recipe: PreparedRecipe<unknown>, name: string) => {
	const query = recipe.document.queries[name];
	if (query?.output.type !== "rows") {
		throw new Error(`Expected the ${name} rows query`);
	}
	return query.output.fields;
};

const fieldExpr = (recipe: PreparedRecipe<unknown>, name: string, key: string) => {
	const field = rowFields(recipe, name).find((entry) => "key" in entry && entry.key === key);
	if (field === undefined || !("expr" in field)) {
		throw new Error(`Expected the ${key} field`);
	}
	return field.expr;
};

const keys = (recipe: PreparedRecipe<unknown>, name: string) =>
	rowFields(recipe, name).map((field) => ("key" in field ? field.key : null));

describe("media comic book query recipes", () => {
	it("selects the pages the comic book schema declares", () => {
		const summary = keys(
			comicBookRecipes.summaryRecipe({ collectionLimit: 6, entityId: "comic-book-1" }),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "pages"]);
		expect(keys(comicBookRecipes.presentationRecipe(["comic-book-1"]), "rows")).toContain("pages");
	});

	it("sums the comic book's pages over its completions and counts completions without pages", () => {
		const activity = comicBookRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "comic-book-1",
			collectionEventLimit: 60,
		});

		expect(fieldExpr(activity, "totals", "consumedAmount")).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					type: "conditional",
					whenTrue: { type: "cast", expr: { path: ["pages"], type: "jsonPath" } },
				},
			},
		});
		expect(JSON.stringify(fieldExpr(activity, "totals", "unknownAmountCount"))).toContain("pages");
	});

	it("reaches the series from the group side of comic-book-group-to-comic-book", () => {
		const overview = comicBookRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			recommendationLimit: 12,
			entityId: "comic-book-1",
		});

		expect(overview.document.queries["group"]?.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "comic-book-group" } },
				{},
				{ right: { type: "literal", value: "comic-book-group-to-comic-book" } },
			],
		});
	});
});

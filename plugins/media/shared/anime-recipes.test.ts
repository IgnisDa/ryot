import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { animeRecipes } from "./anime-recipes";

const ACTIVITY_RECIPE = animeRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "anime-1",
	collectionEventLimit: 60,
});

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

describe("media anime query recipes", () => {
	it("selects the episode count and airing schedule the anime schema declares", () => {
		const summary = keys(
			animeRecipes.summaryRecipe({ collectionLimit: 6, entityId: "anime-1" }),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "episodes", "airingSchedule"]);
		expect(keys(animeRecipes.presentationRecipe(["anime-1"]), "rows")).toContain("episodes");
	});

	it("carries the recorded episode on every activity event", () => {
		expect(keys(ACTIVITY_RECIPE, "events").at(-1)).toBe("animeEpisode");
		expect(fieldExpr(ACTIVITY_RECIPE, "events", "animeEpisode")).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["animeEpisode"] },
		});
	});

	it("sums the anime's episodes over its completions", () => {
		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "consumedAmount")).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					type: "conditional",
					whenTrue: { type: "cast", expr: { type: "jsonPath", path: ["episodes"] } },
				},
			},
		});
		expect(JSON.stringify(fieldExpr(ACTIVITY_RECIPE, "totals", "unknownAmountCount"))).toContain(
			"episodes",
		);
	});

	it("asks for no group because anime has none", () => {
		const overview = animeRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "anime-1",
			recommendationLimit: 12,
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});

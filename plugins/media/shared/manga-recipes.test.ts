import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import {
	mangaActivityRecipe,
	mangaOverviewRecipe,
	mangaPresentationRecipe,
	mangaSummaryRecipe,
} from "./manga-recipes";

const ACTIVITY_RECIPE = mangaActivityRecipe({
	eventLimit: 60,
	entityId: "manga-1",
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

describe("media manga query recipes", () => {
	it("selects the chapter and volume counts the manga schema declares", () => {
		const summary = keys(
			mangaSummaryRecipe({ collectionLimit: 6, entityId: "manga-1" }),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "volumes", "chapters"]);
		expect(keys(mangaPresentationRecipe(["manga-1"]), "rows")).toContain("chapters");
	});

	it("carries the recorded volume and chapter on every activity event", () => {
		expect(keys(ACTIVITY_RECIPE, "events").slice(-2)).toEqual(["mangaVolume", "mangaChapter"]);
		expect(fieldExpr(ACTIVITY_RECIPE, "events", "mangaChapter")).toMatchObject({
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", path: ["mangaChapter"] },
		});
	});

	it("sums the manga's chapters over its completions", () => {
		expect(fieldExpr(ACTIVITY_RECIPE, "totals", "consumedAmount")).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "sum",
				expr: {
					type: "conditional",
					whenTrue: { type: "cast", expr: { type: "jsonPath", path: ["chapters"] } },
				},
			},
		});
		expect(JSON.stringify(fieldExpr(ACTIVITY_RECIPE, "totals", "unknownAmountCount"))).toContain(
			"chapters",
		);
	});

	it("asks for no group because manga has none", () => {
		const overview = mangaOverviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			entityId: "manga-1",
			recommendationLimit: 12,
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});

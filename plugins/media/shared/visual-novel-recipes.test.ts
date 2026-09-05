import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { visualNovelRecipes } from "./visual-novel-recipes";

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

describe("media visual novel query recipes", () => {
	it("selects the length the visual novel schema declares", () => {
		const summary = keys(
			visualNovelRecipes.summaryRecipe({ collectionLimit: 6, entityId: "visual-novel-1" }),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "lengthMinutes"]);
		expect(keys(visualNovelRecipes.presentationRecipe(["visual-novel-1"]), "rows")).toContain(
			"lengthMinutes",
		);
	});

	it("falls back to the visual novel length when a completion recorded no time spent", () => {
		const activity = visualNovelRecipes.activityRecipe({
			eventLimit: 60,
			collectionEventLimit: 60,
			entityId: "visual-novel-1",
		});

		expect(fieldExpr(activity, "totals", "consumedAmount")).toMatchObject({
			type: "aggregate",
			aggregation: { function: "sum", expr: { whenTrue: { type: "coalesce" } } },
		});
		expect(JSON.stringify(fieldExpr(activity, "totals", "consumedAmount"))).toContain(
			"lengthMinutes",
		);
		expect(JSON.stringify(fieldExpr(activity, "totals", "unknownAmountCount"))).toContain(
			"lengthMinutes",
		);
	});

	it("asks for no group because visual novels have none", () => {
		const overview = visualNovelRecipes.overviewRecipe({
			groupLimit: 20,
			peopleLimit: 12,
			companyLimit: 6,
			recommendationLimit: 12,
			entityId: "visual-novel-1",
		});

		expect(Object.keys(overview.document.queries)).toEqual([
			"companies",
			"people",
			"recommendations",
		]);
	});
});

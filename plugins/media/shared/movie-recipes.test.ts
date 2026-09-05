import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { describe, expect, it } from "vitest";

import { movieRecipes } from "./movie-recipes";

const SUMMARY_RECIPE = movieRecipes.summaryRecipe({ collectionLimit: 6, entityId: "movie-1" });

const TOTALS = movieRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "movie-1",
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

describe("media movie query recipes", () => {
	it("selects the watch providers and runtime the movie schema declares", () => {
		expect(keys(SUMMARY_RECIPE, "summary").slice(-3)).toEqual([
			"progressPercent",
			"watchProviders",
			"runtime",
		]);
		expect(keys(movieRecipes.presentationRecipe(["movie-1"]), "rows")).toContain("runtime");
	});

	it("derives flat lifecycle state without any session-scoped predicate", () => {
		expect(JSON.stringify(fieldExpr(SUMMARY_RECIPE, "summary", "state"))).not.toContain(
			"sessionEntityId",
		);
		expect(JSON.stringify(fieldExpr(SUMMARY_RECIPE, "summary", "progressPercent"))).not.toContain(
			"sessionEntityId",
		);
	});

	it("reports the progress percent only after the entity's own latest completion", () => {
		const progress = fieldExpr(SUMMARY_RECIPE, "summary", "progressPercent");
		if (progress.type !== "conditional") {
			throw new Error("Expected a boundary-gated progress percent");
		}
		const serialized = JSON.stringify(progress.condition);

		expect(serialized).toContain("movieSummaryLifecycleBoundary");
		expect(serialized).toContain("movieSummaryLifecycleProgress");
		expect(progress.whenFalse).toEqual({ value: null, type: "literal" });
	});

	it("falls back to the movie runtime when a completion recorded no time spent", () => {
		const amount = fieldExpr(TOTALS, "totals", "consumedAmount");

		expect(amount).toMatchObject({
			type: "aggregate",
			aggregation: { function: "sum", expr: { whenTrue: { type: "coalesce" } } },
		});
		expect(JSON.stringify(amount)).toContain("runtime");
		expect(JSON.stringify(fieldExpr(TOTALS, "totals", "unknownAmountCount"))).toContain("runtime");
	});
});

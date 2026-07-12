import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { audiobookRecipes } from "./audiobook-recipes";

const OVERVIEW_RECIPE = audiobookRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "audiobook-1",
	recommendationLimit: 12,
});

const singleRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

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

describe("media audiobook query recipes", () => {
	it("selects the runtime the audiobook schema declares", () => {
		const summary = keys(
			audiobookRecipes.summaryRecipe({ collectionLimit: 6, entityId: "audiobook-1" }),
			"summary",
		);

		expect(summary.slice(-2)).toEqual(["progressPercent", "runtime"]);
		expect(keys(audiobookRecipes.presentationRecipe(["audiobook-1"]), "rows")).toContain("runtime");
	});

	it("falls back to the audiobook runtime when a completion recorded no time spent", () => {
		const activity = audiobookRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "audiobook-1",
			collectionEventLimit: 60,
		});

		expect(fieldExpr(activity, "totals", "consumedAmount")).toMatchObject({
			type: "aggregate",
			aggregation: { function: "sum", expr: { whenTrue: { type: "coalesce" } } },
		});
		expect(JSON.stringify(fieldExpr(activity, "totals", "consumedAmount"))).toContain("runtime");
		expect(JSON.stringify(fieldExpr(activity, "totals", "unknownAmountCount"))).toContain(
			"runtime",
		);
	});

	it("reaches the series from the group side of audiobook-group-to-audiobook", () => {
		expect(OVERVIEW_RECIPE.document.queries["group"]?.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "audiobook-group" } },
				{},
				{ right: { type: "literal", value: "audiobook-group-to-audiobook" } },
			],
		});
	});

	it("decodes the unlinked creators alongside the credits", () => {
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					group: singleRows([]),
					people: singleRows([]),
					companies: singleRows([]),
					recommendations: singleRows([]),
					creators: singleRows([{ unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }] }]),
				},
			}),
		).toMatchObject({
			success: { creators: { unlinkedCreators: [{ role: "Narrator", name: "Nia Voice" }] } },
		});
	});
});

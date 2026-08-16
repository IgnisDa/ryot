import type { PreparedRecipe } from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { bookRecipes } from "./book-recipes";

const OVERVIEW_RECIPE = bookRecipes.overviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "book-1",
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

describe("media book query recipes", () => {
	it("selects the pages and compilation fields the book schema declares", () => {
		const summary = keys(
			bookRecipes.summaryRecipe({ collectionLimit: 6, entityId: "book-1" }),
			"summary",
		);

		expect(summary.slice(-3)).toEqual(["progressPercent", "pages", "isCompilation"]);
		expect(summary).not.toContain("watchProviders");
		expect(keys(bookRecipes.presentationRecipe(["book-1"]), "rows")).toContain("pages");
	});

	it("sums the book's pages over its completions and counts completions of an unpaged book", () => {
		const activity = bookRecipes.activityRecipe({
			eventLimit: 60,
			entityId: "book-1",
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
		expect(JSON.stringify(fieldExpr(activity, "totals", "unknownAmountCount"))).not.toContain(
			"timeSpent",
		);
	});

	it("reaches the series from the group side of book-group-to-book", () => {
		expect(OVERVIEW_RECIPE.document.queries["group"]?.where).toMatchObject({
			predicates: [
				{ right: { type: "literal", value: "book-group" } },
				{},
				{ right: { type: "literal", value: "book-group-to-book" } },
			],
		});
	});

	it("decodes the unlinked creators alongside the credits", () => {
		const overviewData = {
			group: singleRows([]),
			people: singleRows([]),
			companies: singleRows([]),
			recommendations: singleRows([]),
		};

		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					...overviewData,
					creators: singleRows([
						{
							unlinkedCreators: [
								{ role: "Author", name: "Ann Author" },
								{ name: "Pan Press", role: "Publisher" },
							],
						},
					]),
				},
			}),
		).toMatchObject({
			success: {
				creators: {
					unlinkedCreators: [
						{ role: "Author", name: "Ann Author" },
						{ name: "Pan Press", role: "Publisher" },
					],
				},
			},
		});
		expect(
			OVERVIEW_RECIPE.decode({
				data: {
					...overviewData,
					creators: singleRows([{ unlinkedCreators: [{ name: "Nameless" }] }]),
				},
			})._tag,
		).toBe("Failure");
	});
});

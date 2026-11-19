import { describe, expect, it } from "bun:test";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("prefers cover artwork and falls back to the first image for the table thumbnail", () => {
		expect(buildViewExpressions("movie").table.image).toMatchObject({
			type: "coalesce",
			values: [
				{
					type: "jsonFirst",
					where: { right: { value: "cover" } },
					array: { expr: { path: ["images"] } },
				},
				{ path: [0], type: "jsonPath", expr: { expr: { path: ["images"] } } },
			],
		});
	});

	it.each([
		["person", ["property.name", "property.birth-place"]],
		["company", ["property.name", "property.founded-year"]],
		["movie-group", ["property.name", "property.parts"]],
		[
			"movie",
			["property.name", "table-column.year", "property.runtime", "table-column.user-rating"],
		],
		[
			"show",
			[
				"property.name",
				"table-column.year",
				"table-column.production-status",
				"table-column.user-rating",
			],
		],
		["book", ["property.name", "table-column.year", "property.pages", "table-column.user-rating"]],
		["custom-schema", ["property.name", "table-column.year", "table-column.user-rating"]],
		[
			"anime",
			["property.name", "table-column.year", "property.episodes", "table-column.user-rating"],
		],
	] as const)("builds the expected %s table columns", (slug, columns) => {
		expect(buildViewExpressions(slug).table.columns.map(({ label }) => label.key)).toEqual<unknown>(
			columns,
		);
	});

	it("assigns persisted display kinds to media values", () => {
		expect(
			buildViewExpressions("book").table.columns.map(({ displayKind }) => displayKind),
		).toEqual(["text", "year", "number", "rating"]);
	});

	it("keeps the summary subtitle on the year column", () => {
		expect(buildViewExpressions("movie").summary.subtitle).toEqual({
			displayKind: "year",
			field: "publishYear",
		});
		expect(buildViewExpressions("person").summary.subtitle).toEqual({
			field: "birthPlace",
			displayKind: "text",
		});
	});
});

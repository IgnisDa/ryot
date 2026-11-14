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
		["person", ["Name", "Birth Place"]],
		["company", ["Name", "Founded Year"]],
		["movie-group", ["Name", "Parts"]],
		["movie", ["Name", "Year", "Runtime", "Your rating"]],
		["show", ["Name", "Year", "Status", "Your rating"]],
		["book", ["Name", "Year", "Pages", "Your rating"]],
		["custom-schema", ["Name", "Year", "Your rating"]],
		["anime", ["Name", "Year", "Episodes", "Your rating"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug).table.columns.map(({ label }) => label)).toEqual<unknown>(
			labels,
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

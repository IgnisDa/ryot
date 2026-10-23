import { describe, expect, it } from "vitest";

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
		["movie", ["Name", "Year", "Runtime"]],
		["show", ["Name", "Year", "Status"]],
		["book", ["Name", "Year", "Pages"]],
		["custom-schema", ["Name", "Year"]],
		["anime", ["Name", "Year", "Episodes"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug).table.columns.map(({ label }) => label)).toEqual(labels);
	});

	it("assigns persisted display kinds to media values", () => {
		expect(
			buildViewExpressions("book").table.columns.map(({ displayKind }) => displayKind),
		).toEqual(["text", "number", "number"]);
	});
});

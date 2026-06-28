import { describe, expect, it } from "vitest";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("projects the first entity image for the table thumbnail", () => {
		expect(buildViewExpressions("movie").table.image).toEqual({
			type: "cast",
			target: "json",
			expr: {
				type: "jsonPath",
				path: ["images", 0],
				expr: { type: "column", field: "properties", tableAlias: "entity" },
			},
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

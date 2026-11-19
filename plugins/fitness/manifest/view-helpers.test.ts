import { describe, expect, it } from "bun:test";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("projects the first entity image only for exercises", () => {
		expect(buildViewExpressions("exercise").table.image).toEqual({
			type: "cast",
			target: "json",
			expr: {
				type: "jsonPath",
				path: ["images", 0],
				expr: { type: "column", field: "properties", tableAlias: "entity" },
			},
		});
		expect(buildViewExpressions("workout-template").table.image).toBeNull();
	});

	it.each([
		["exercise", ["table-column.name", "property.level"]],
		["workout-template", ["table-column.name", "table-column.created-at", "property.comment"]],
	] as const)("builds the expected %s table columns", (slug, keys) => {
		expect(buildViewExpressions(slug).table.columns.map(({ label }) => label.key)).toEqual<unknown>(
			keys,
		);
	});
});

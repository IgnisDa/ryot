import { describe, expect, it } from "vitest";

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
		["exercise", ["Name", "Level"]],
		["workout-template", ["Name", "Created At", "Comment"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug).table.columns.map(({ label }) => label)).toEqual(labels);
	});
});

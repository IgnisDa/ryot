import { describe, expect, it } from "vitest";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("uses title case expressions for exercise card slots", () => {
		const expressions = buildViewExpressions("exercise", "Exercise");

		expect(expressions.grid.image).toEqual({
			type: "cast",
			target: "json",
			expr: {
				type: "jsonPath",
				path: ["images", 0],
				expr: { type: "column", field: "properties", tableAlias: "entity" },
			},
		});
		expect(expressions.grid.callout).toMatchObject({ name: "titleCase", type: "transform" });
		expect(expressions.grid.primaryMetadata).toMatchObject({
			name: "titleCase",
			type: "transform",
		});
		expect(expressions.grid.secondaryMetadata).toMatchObject({
			name: "titleCase",
			type: "transform",
		});
	});

	it("uses a literal schema name for every card overline", () => {
		const expressions = buildViewExpressions("workout", "Workout");

		expect(expressions.grid.overline).toEqual({ type: "literal", value: "Workout" });
		expect(expressions.list.overline).toEqual({ type: "literal", value: "Workout" });
	});

	it.each([
		["exercise", ["Name", "Level", "Equipment"]],
		["workout", ["Name", "Started At", "Ended At"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug, "Schema").table.columns.map(({ label }) => label)).toEqual(
			labels,
		);
	});
});

import { describe, expect, it } from "vitest";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("uses title case expressions for exercise card slots", () => {
		const expressions = buildViewExpressions("exercise", "Exercise");

		expect(expressions.grid.callout).toMatchObject({ name: "titleCase", type: "transform" });
		expect(expressions.grid.primarySubtitle).toMatchObject({
			name: "titleCase",
			type: "transform",
		});
		expect(expressions.grid.secondarySubtitle).toMatchObject({
			name: "titleCase",
			type: "transform",
		});
	});

	it("uses a literal schema name for every card eyebrow", () => {
		const expressions = buildViewExpressions("workout", "Workout");

		expect(expressions.grid.eyebrow).toEqual({ type: "literal", value: "Workout" });
		expect(expressions.list.eyebrow).toEqual({ type: "literal", value: "Workout" });
	});

	it.each([
		["exercise", ["Name", "Level", "Equipment"]],
		["workout", ["Name", "Started At", "Ended At"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug, "Schema").table.map(({ label }) => label)).toEqual(labels);
	});
});

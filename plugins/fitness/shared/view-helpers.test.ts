import { describe, expect, it } from "vitest";

import { buildDisplayConfig } from "./view-helpers";

describe("buildDisplayConfig", () => {
	it("uses the expected fitness callouts", () => {
		expect(buildDisplayConfig("exercise").grid.calloutProperty).not.toBeNull();
		expect(buildDisplayConfig("workout").grid.calloutProperty).toBeNull();
		expect(buildDisplayConfig("workout-template").grid.calloutProperty).toBeNull();
		expect(buildDisplayConfig("measurement").grid.calloutProperty).toBeNull();
	});

	it.each([
		["exercise", ["Name", "Level", "Equipment"]],
		["workout", ["Name", "Started At", "Ended At"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildDisplayConfig(slug).table.columns.map(({ label }) => label)).toEqual(labels);
	});
});

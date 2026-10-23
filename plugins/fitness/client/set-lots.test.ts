import { describe, expect, it } from "vitest";

import { setLabels } from "./set-lots";

describe("set lot labels", () => {
	it("letters warm-up, drop and failure sets and numbers only the others", () => {
		expect(setLabels(["warm_up", "normal", "drop", "normal", "failure"])).toEqual([
			"W",
			"1",
			"D",
			"2",
			"F",
		]);
	});
});

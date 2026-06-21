import { describe, expect, it } from "vitest";

import { savedViewResultCount, savedViewTotalCount } from "./result-count";

describe("saved-view result counts", () => {
	it("shows exact final counts", () => {
		expect(savedViewResultCount(1, false)).toBe("1 result");
		expect(savedViewResultCount(2, false)).toBe("2 results");
	});

	it("shows lower bounds when more results exist", () => {
		expect(savedViewResultCount(1, true)).toBe("1+ results");
		expect(savedViewResultCount(20, true)).toBe("20+ results");
	});

	it("shows loaded progress against a resolved total", () => {
		expect(savedViewTotalCount(20, 500)).toBe("20 of 500 results");
		expect(savedViewTotalCount(1, 1)).toBe("1 of 1 results");
	});
});

import { describe, expect, it } from "vitest";

import { savedViewLoadedCount, savedViewResultCount } from "./result-count";

describe("saved-view result counts", () => {
	it("shows exact final counts", () => {
		expect(savedViewResultCount(1, false)).toBe("1 result");
		expect(savedViewResultCount(2, false)).toBe("2 results");
		expect(savedViewLoadedCount(2, false)).toBe("2 loaded");
	});

	it("shows lower bounds when more results exist", () => {
		expect(savedViewResultCount(1, true)).toBe("1+ results");
		expect(savedViewLoadedCount(20, true)).toBe("20+ loaded");
	});
});

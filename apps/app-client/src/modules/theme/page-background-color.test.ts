import { describe, expect, it } from "vitest";

import { pageBackgroundColor } from "./page-background-color";

describe("page background color", () => {
	it("follows the system scheme when no theme is chosen", () => {
		expect(pageBackgroundColor("system", "dark")).toBe("#101113");
		expect(pageBackgroundColor("system", "light")).toBe("#f5f2ec");
	});

	it("falls back to the light base when the system scheme is unspecified", () => {
		expect(pageBackgroundColor("system", "unspecified")).toBe("#f5f2ec");
	});

	it("prefers an explicit theme over the system scheme", () => {
		expect(pageBackgroundColor("dark", "light")).toBe("#101113");
		expect(pageBackgroundColor("light", "dark")).toBe("#f5f2ec");
	});
});

import { describe, expect, it } from "bun:test";

import { trimToNull } from "./validation";

describe("trimToNull", () => {
	it("returns null for an empty string", () => {
		expect(trimToNull("")).toBeNull();
	});

	it("returns null for a whitespace-only string", () => {
		expect(trimToNull("   ")).toBeNull();
	});

	it("trims and returns the value for a padded string", () => {
		expect(trimToNull("  hello  ")).toBe("hello");
	});

	it("returns the value unchanged for a clean string", () => {
		expect(trimToNull("hello")).toBe("hello");
	});
});

import { describe, expect, it } from "bun:test";

import { resolveError } from "./form-utils";

describe("resolveError", () => {
	it("returns a string error as-is", () => {
		expect(resolveError("something went wrong")).toBe("something went wrong");
	});

	it("returns undefined for null", () => {
		expect(resolveError(null)).toBeUndefined();
	});

	it("returns undefined for undefined", () => {
		expect(resolveError(undefined)).toBeUndefined();
	});

	it("returns undefined for a number", () => {
		expect(resolveError(123)).toBeUndefined();
	});

	it("returns undefined for an object without a message property", () => {
		expect(resolveError({ code: "ERR_001" })).toBeUndefined();
	});

	it("extracts the message from an object with a message property", () => {
		expect(resolveError({ message: "field is required" })).toBe("field is required");
	});

	it("stringifies a non-string message value", () => {
		expect(resolveError({ message: 42 })).toBe("42");
	});
});

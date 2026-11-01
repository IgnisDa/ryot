import { describe, expect, it } from "vitest";

import { isNumber, isString, sealPrimordials, uncurry } from "./primordials";

describe("isolate primordials", () => {
	it("calls the captured method on the receiver it is given", () => {
		const trim = uncurry(String.prototype, "trim", isString);

		expect(trim("  padded  ")).toBe("padded");
	});

	it("fails closed when the method is missing", () => {
		expect(() => uncurry(String.prototype, "notAStringMethod", isString)).toThrow(
			"Sandbox runner primordial is missing: notAStringMethod",
		);
	});

	it("rejects a result of an unexpected type", () => {
		const trim = uncurry(String.prototype, "trim", isNumber);

		expect(() => trim(" a ")).toThrow("returned an unexpected result: trim");
	});

	it("refuses new captures once sealed", () => {
		sealPrimordials();

		expect(() => uncurry(String.prototype, "trim", isString)).toThrow(
			"Sandbox runner primordials are sealed: trim",
		);
	});
});

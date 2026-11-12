import { describe, expect, test } from "bun:test";

import { truncateJsonResult } from "#platform/tool-result";

describe("agent tool result budgets", () => {
	test("preserves JSON values that fit including the envelope", () => {
		const value = { items: [null, false, 42, "small"] };
		expect(truncateJsonResult(value, 128)).toEqual({ value, truncated: false });
	});

	test("bounds the serialized UTF-8 envelope without splitting multibyte characters", () => {
		const value = { text: '界🙂"\\\n'.repeat(100) };
		for (const budget of [64, 65, 80, 127, 256]) {
			const result = truncateJsonResult(value, budget);
			expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(budget);
			expect(result.truncated).toBe(true);
			if (result.truncated) {
				expect(JSON.stringify(value).startsWith(result.jsonPrefix)).toBe(true);
				expect(result.jsonPrefix.isWellFormed()).toBe(true);
				expect(result.jsonPrefix.length).toBeGreaterThan(0);
			}
		}
	});

	test("truncates arrays and primitive results and rejects unusable budgets", () => {
		expect(
			truncateJsonResult(
				Array.from({ length: 100 }, (_, index) => index),
				64,
			).truncated,
		).toBe(true);
		expect(truncateJsonResult("x".repeat(100), 64).truncated).toBe(true);
		for (const budget of [0, 63, 64.5, Infinity, Number.NaN]) {
			expect(() => truncateJsonResult(null, budget)).toThrow(RangeError);
		}
	});
});

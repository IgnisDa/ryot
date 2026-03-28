import { describe, expect, it } from "bun:test";
import {
	normalizeBuiltinMediaEventProperties,
	normalizeProgressPercent,
	roundHalfUpToTwoDecimals,
} from "./media-lifecycle-validation";

describe("roundHalfUpToTwoDecimals", () => {
	it("rounds half up to two decimal places", () => {
		expect(roundHalfUpToTwoDecimals(1.005)).toBe(1.01);
		expect(roundHalfUpToTwoDecimals(25.554)).toBe(25.55);
		expect(roundHalfUpToTwoDecimals(25.555)).toBe(25.56);
	});
});

describe("normalizeProgressPercent", () => {
	it("returns a rounded progress percent within range", () => {
		expect(normalizeProgressPercent(42.424)).toBe(42.42);
		expect(normalizeProgressPercent(42.425)).toBe(42.43);
	});

	it("rejects values that normalize to zero or below", () => {
		expect(() => normalizeProgressPercent(0)).toThrow(
			"Progress percent must be greater than 0 and less than 100",
		);
		expect(() => normalizeProgressPercent(0.004)).toThrow(
			"Progress percent must be greater than 0 and less than 100",
		);
	});

	it("rejects values that normalize to one hundred or above", () => {
		expect(() => normalizeProgressPercent(100)).toThrow(
			"Progress percent must be greater than 0 and less than 100",
		);
		expect(() => normalizeProgressPercent(99.995)).toThrow(
			"Progress percent must be greater than 0 and less than 100",
		);
	});
});

describe("normalizeBuiltinMediaEventProperties", () => {
	it("returns untouched properties for non-progress events", () => {
		expect(
			normalizeBuiltinMediaEventProperties({
				isBuiltin: false,
				properties: {},
				entitySchemaSlug: "custom",
				eventSchemaSlug: "backlog",
			}),
		).toEqual({});
	});

	it("normalizes progress event properties", () => {
		expect(
			normalizeBuiltinMediaEventProperties({
				isBuiltin: true,
				entitySchemaSlug: "book",
				eventSchemaSlug: "progress",
				properties: { progressPercent: 58.335 },
			}),
		).toEqual({ progressPercent: 58.34 });
	});

	it("does not normalize custom progress events", () => {
		expect(
			normalizeBuiltinMediaEventProperties({
				isBuiltin: false,
				entitySchemaSlug: "custom",
				eventSchemaSlug: "progress",
				properties: { progressPercent: 100 },
			}),
		).toEqual({ progressPercent: 100 });
	});
});

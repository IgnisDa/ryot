import { describe, expect, it } from "vitest";

import { formatSavedViewValue } from "./display-value";

describe("formatSavedViewValue", () => {
	it.each([
		[{ kind: "text", value: "Piranesi" } as const, "Piranesi"],
		[{ kind: "number", value: 1234.5 } as const, "1,234.5"],
		[{ kind: "date", value: "2026-08-12" } as const, "8/12/2026"],
		[{ kind: "boolean", value: true } as const, "Yes"],
		[{ kind: "boolean", value: false } as const, "No"],
		[{ kind: "json", value: { pages: 304 } } as const, '{"pages":304}'],
		[{ kind: "null", value: null } as const, ""],
	])("formats scalar value %#", (value, expected) => {
		expect(formatSavedViewValue(value, "en-US")).toBe(expected);
	});

	it("returns invalid dates unchanged", () => {
		expect(formatSavedViewValue({ kind: "date", value: "not-a-date" }, "en-US")).toBe("not-a-date");
	});

	it("never uses object string coercion for JSON", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(formatSavedViewValue({ kind: "json", value: circular })).toBe("null");
	});
});

import { describe, expect, it } from "vitest";

import { formatSavedViewValue } from "./display-value";

describe("formatSavedViewValue", () => {
	it.each([
		[{ displayKind: "text", value: "Piranesi" } as const, "Piranesi"],
		[{ displayKind: "number", value: 1234.5 } as const, "1,234.5"],
		[{ displayKind: "date", value: "2026-08-12" } as const, "8/12/2026"],
		[{ displayKind: "boolean", value: true } as const, "Yes"],
		[{ displayKind: "boolean", value: false } as const, "No"],
		[{ displayKind: "json", value: { pages: 304 } } as const, '{"pages":304}'],
		[{ displayKind: "text", value: null } as const, ""],
	])("formats scalar value %#", (value, expected) => {
		expect(formatSavedViewValue(value, "en-US")).toBe(expected);
	});
});

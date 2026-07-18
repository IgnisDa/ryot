import { describe, expect, it } from "vitest";

import { formatSavedViewValue } from "#/modules/saved-views/display-value";

describe("saved-view display values", () => {
	it("formats each persisted display kind", () => {
		expect(formatSavedViewValue({ displayKind: "text", value: "Piranesi" }, "en-US")).toBe(
			"Piranesi",
		);
		expect(formatSavedViewValue({ displayKind: "number", value: 1234.5 }, "en-US")).toBe("1,234.5");
		expect(formatSavedViewValue({ displayKind: "boolean", value: true }, "en-US")).toBe("Yes");
		expect(formatSavedViewValue({ displayKind: "boolean", value: false }, "en-US")).toBe("No");
		expect(formatSavedViewValue({ displayKind: "json", value: { pages: 272 } }, "en-US")).toBe(
			'{"pages":272}',
		);
		expect(formatSavedViewValue({ displayKind: "date", value: "2026-08-12" }, "en-US")).toBe(
			"8/12/2026",
		);
	});

	it.each(["text", "number", "boolean", "date"] as const)(
		"renders a null %s value as empty text",
		(displayKind) => {
			expect(formatSavedViewValue({ displayKind, value: null })).toBe("");
		},
	);
});

import { describe, expect, it } from "vitest";

import { cellText } from "./display-value";

describe("cellText", () => {
	it("formats years without grouping and numbers with grouping", () => {
		expect(cellText({ value: 1995, displayKind: "year" })).toBe("1995");
		expect(cellText({ value: 1995, displayKind: "number" })).toBe(
			new Intl.NumberFormat().format(1995),
		);
		expect(cellText({ value: null, displayKind: "year" })).toBe("");
	});
});

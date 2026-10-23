import { describe, expect, it } from "vitest";

import { normalizePlainDescription } from "./plain-description";

describe("plain descriptions", () => {
	it("keeps provider prose literal, including HTML, links, and Markdown", () => {
		expect(normalizePlainDescription("  <b>Title</b> *plot* [site](https://example.org)  ")).toBe(
			"\\<b\\>Title\\<\\/b\\> \\*plot\\* \\[site\\]\\(https\\:\\/\\/example\\.org\\)",
		);
	});

	it("preserves line breaks after trimming", () => {
		expect(normalizePlainDescription(" \r\nFirst\r\nSecond\r\n\r\nLast\r\n ")).toBe(
			"First\\\nSecond\n\nLast",
		);
	});

	it.each([undefined, null, 42, {}, "", " \n\t "])("returns null for absent prose: %j", (input) => {
		expect(normalizePlainDescription(input)).toBeNull();
	});
});

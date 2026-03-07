import { describe, expect, it } from "bun:test";
import { facetIconOptions, getFacetIconOption } from "./icons";

describe("facetIconOptions", () => {
	it("stores lucide icon keys with lucide prefix", () => {
		const hasOnlyLucidePrefixedKeys = facetIconOptions.every((option) =>
			option.value.startsWith("lucide:"),
		);

		expect(hasOnlyLucidePrefixedKeys).toBe(true);
	});

	it("resolves known lucide icon values", () => {
		const option = getFacetIconOption("lucide:book-open");

		expect(option?.label).toBe("Book Open");
	});

	it("does not resolve unknown icon values", () => {
		const option = getFacetIconOption("🎯");

		expect(option).toBeUndefined();
	});
});

import { describe, expect, it } from "bun:test";
import { iconNames } from "lucide-react/dynamic.mjs";
import { facetIconOptions, getFacetIconOption } from "./icons";

describe("facetIconOptions", () => {
	it("exposes all lucide icons", () => {
		const values = facetIconOptions.map((option) => option.value);

		expect(values).toEqual(iconNames);
	});

	it("resolves known lucide icon values", () => {
		const option = getFacetIconOption("book-open");

		expect(option?.label).toBe("Book Open");
	});

	it("does not resolve unknown icon values", () => {
		const option = getFacetIconOption("🎯");

		expect(option).toBeUndefined();
	});
});

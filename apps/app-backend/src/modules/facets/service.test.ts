import { describe, expect, it } from "bun:test";
import { resolveFacetSlug } from "./service";

describe("resolveFacetSlug", () => {
	it("builds slug from facet name when slug is omitted", () => {
		expect(resolveFacetSlug({ name: "Whiskey Notes" })).toBe("whiskey-notes");
	});

	it("normalizes the provided slug", () => {
		expect(
			resolveFacetSlug({ name: "Whiskey", slug: "  My_Custom Facet  " }),
		).toBe("my-custom-facet");
	});

	it("throws when the slug cannot be derived", () => {
		expect(() => resolveFacetSlug({ name: "!!!" })).toThrow(
			"Facet slug is required",
		);
	});
});

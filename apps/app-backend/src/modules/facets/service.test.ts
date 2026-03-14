import { describe, expect, it } from "bun:test";
import {
	buildFacetOrder,
	resolveFacetPatch,
	resolveFacetSlug,
} from "./service";

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

describe("resolveFacetPatch", () => {
	it("keeps current slug when neither name nor slug changes", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: null,
				slug: "media",
				name: "Media",
				description: null,
				accentColor: null,
			},
			input: { description: "Default media facet" },
		});

		expect(patch.slug).toBe("media");
		expect(patch.description).toBe("Default media facet");
	});

	it("recomputes slug when name changes", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: null,
				slug: "whiskey",
				name: "Whiskey",
				description: null,
				accentColor: null,
			},
			input: { name: "Whiskey Notes" },
		});

		expect(patch.slug).toBe("whiskey-notes");
		expect(patch.name).toBe("Whiskey Notes");
	});

	it("prefers explicit slug over derived slug", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: null,
				slug: "coffee",
				name: "Coffee",
				description: null,
				accentColor: null,
			},
			input: { name: "Coffee Notes", slug: "Cups_And_Brews" },
		});

		expect(patch.slug).toBe("cups-and-brews");
	});
});

describe("buildFacetOrder", () => {
	it("keeps unspecified facets after requested order", () => {
		const nextOrder = buildFacetOrder({
			currentFacetIds: ["a", "b", "c", "d"],
			requestedFacetIds: ["c", "a"],
		});

		expect(nextOrder).toEqual(["c", "a", "b", "d"]);
	});

	it("supports new facets in requested order", () => {
		const nextOrder = buildFacetOrder({
			currentFacetIds: ["a", "b"],
			requestedFacetIds: ["x", "b"],
		});

		expect(nextOrder).toEqual(["x", "b", "a"]);
	});
});

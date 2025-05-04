import { describe, expect, it } from "bun:test";
import { buildFacetOrder, resolveFacetPatch } from "./service";

describe("resolveFacetPatch", () => {
	it("keeps current slug when neither name nor slug changes", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Default media facet" },
		});

		expect(patch.slug).toBe("media");
		expect(patch.description).toBe("Default media facet");
	});

	it("recomputes slug when name changes", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: "coffee",
				slug: "whiskey",
				name: "Whiskey",
				description: null,
				accentColor: "#D4A574",
			},
			input: { name: "Whiskey Notes" },
		});

		expect(patch.slug).toBe("whiskey-notes");
		expect(patch.name).toBe("Whiskey Notes");
	});

	it("prefers explicit slug over derived slug", () => {
		const patch = resolveFacetPatch({
			current: {
				slug: "coffee",
				name: "Coffee",
				icon: "cup-soda",
				description: null,
				accentColor: "#D4A574",
			},
			input: { name: "Coffee Notes", slug: "Cups_And_Brews" },
		});

		expect(patch.slug).toBe("cups-and-brews");
	});

	it("keeps the current icon when icon is omitted", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Track media" },
		});

		expect(patch.icon).toBe("film");
	});

	it("keeps the current accent color when accentColor is omitted", () => {
		const patch = resolveFacetPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { icon: "camera", description: "Track media" },
		});

		expect(patch.accentColor).toBe("#5B7FFF");
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

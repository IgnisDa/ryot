import { describe, expect, it } from "bun:test";
import { toTrackingNavItems } from "./nav";
import { createFacetFixture } from "./test-fixtures";

const f = createFacetFixture;
const facet = (
	id: string,
	name: string,
	slug: string,
	sortOrder = 1,
	enabled = true,
) => f({ id, name, slug, enabled, sortOrder });

describe("toTrackingNavItems", () => {
	it("includes enabled and disabled facets", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2, false),
			facet("3", "Music", "music", 3),
		];

		const items = toTrackingNavItems(facets);

		expect(items.length).toBe(3);
		expect(items[0]?.facetSlug).toBe("media");
		expect(items[1]?.facetSlug).toBe("people");
		expect(items[2]?.facetSlug).toBe("music");
		expect(items[1]?.enabled).toBe(false);
	});

	it("applies deterministic ordering from unsorted input", () => {
		const facets = [
			facet("1", "Zebra Music", "z-music", 3),
			facet("2", "Apple Media", "a-media"),
			facet("3", "Mango People", "m-people", 2),
		];

		const items = toTrackingNavItems(facets);

		expect(items.length).toBe(3);
		expect(items[0]?.facetSlug).toBe("a-media");
		expect(items[1]?.facetSlug).toBe("m-people");
		expect(items[2]?.facetSlug).toBe("z-music");
	});

	it("returns empty array when there are no facets", () => {
		const items = toTrackingNavItems([]);

		expect(items.length).toBe(0);
	});

	it("keeps disabled facets in ordered output", () => {
		const facets = [
			facet("1", "Media", "media", 2, false),
			facet("2", "People", "people", 1, false),
		];

		const items = toTrackingNavItems(facets);

		expect(items.length).toBe(2);
		expect(items[0]?.facetSlug).toBe("people");
		expect(items[1]?.facetSlug).toBe("media");
		expect(items[0]?.enabled).toBe(false);
		expect(items[1]?.enabled).toBe(false);
	});

	it("maps facets to nav items with correct properties", () => {
		const facets = [facet("1", "Media", "media")];

		const items = toTrackingNavItems(facets);

		expect(items).toHaveLength(1);
		expect(items[0]).toEqual({
			facetId: "1",
			enabled: true,
			label: "Media",
			icon: undefined,
			isBuiltin: false,
			facetSlug: "media",
		});
	});

	it("preserves builtin flag for edit gating", () => {
		const builtInFacet = facet("1", "Media", "media", 1, true);
		builtInFacet.isBuiltin = true;
		const facets = [builtInFacet];

		const items = toTrackingNavItems(facets);

		expect(items).toHaveLength(1);
		expect(items[0]?.isBuiltin).toBe(true);
	});
});

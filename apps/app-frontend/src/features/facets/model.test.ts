import { describe, expect, it } from "bun:test";
import {
	findFacetBySlug,
	selectEnabledFacets,
	sortFacetsByOrder,
} from "./model";
import { createFacetFixture } from "./test-fixtures";

const f = createFacetFixture;
const mkFacet = (
	id: string,
	name: string,
	slug: string,
	sortOrder = 1,
	enabled = true,
) => f({ id, name, slug, enabled, sortOrder });

describe("sortFacetsByOrder", () => {
	it("sorts facets by ascending sortOrder", () => {
		const facets = [
			mkFacet("1", "Media", "media", 3),
			mkFacet("2", "People", "people"),
			mkFacet("3", "Music", "music", 2),
		];

		const sorted = sortFacetsByOrder(facets);

		expect(sorted[0]?.slug).toBe("people");
		expect(sorted[1]?.slug).toBe("music");
		expect(sorted[2]?.slug).toBe("media");
	});

	it("breaks ties by name ascending", () => {
		const facets = [
			mkFacet("1", "Zebra", "zebra"),
			mkFacet("2", "Apple", "apple"),
			mkFacet("3", "Banana", "banana"),
		];

		const sorted = sortFacetsByOrder(facets);

		expect(sorted[0]?.slug).toBe("apple");
		expect(sorted[1]?.slug).toBe("banana");
		expect(sorted[2]?.slug).toBe("zebra");
	});

	it("breaks name ties by slug ascending", () => {
		const facets = [
			mkFacet("1", "Same", "z-facet"),
			mkFacet("2", "Same", "a-facet"),
			mkFacet("3", "Same", "m-facet"),
		];

		const sorted = sortFacetsByOrder(facets);

		expect(sorted[0]?.slug).toBe("a-facet");
		expect(sorted[1]?.slug).toBe("m-facet");
		expect(sorted[2]?.slug).toBe("z-facet");
	});

	it("maintains stable ordering for deterministic nav", () => {
		const facets = [
			mkFacet("1", "Alpha", "slug-a", 5),
			mkFacet("2", "Beta", "slug-b", 5),
			mkFacet("3", "Charlie", "slug-c", 5),
		];

		const sorted1 = sortFacetsByOrder(facets);
		const sorted2 = sortFacetsByOrder(facets);

		expect(sorted1.map((f) => f.slug)).toEqual(sorted2.map((f) => f.slug));
	});
});

describe("selectEnabledFacets", () => {
	it("filters to only enabled facets", () => {
		const facets = [
			mkFacet("1", "Media", "media"),
			mkFacet("2", "People", "people", 2, false),
			mkFacet("3", "Music", "music", 3),
		];

		const enabled = selectEnabledFacets(facets);

		expect(enabled.length).toBe(2);
		expect(enabled[0]?.slug).toBe("media");
		expect(enabled[1]?.slug).toBe("music");
	});

	it("returns empty array when no facets are enabled", () => {
		const facets = [
			mkFacet("1", "Media", "media", 1, false),
			mkFacet("2", "People", "people", 2, false),
		];

		const enabled = selectEnabledFacets(facets);

		expect(enabled?.length).toBe(0);
	});

	it("returns all facets when all are enabled", () => {
		const facets = [
			mkFacet("1", "Media", "media"),
			mkFacet("2", "People", "people", 2),
		];

		const enabled = selectEnabledFacets(facets);

		expect(enabled.length).toBe(2);
	});
});

describe("findFacetBySlug", () => {
	it("finds facet by slug", () => {
		const facets = [
			mkFacet("1", "Media", "media"),
			mkFacet("2", "People", "people", 2),
		];

		const facet = findFacetBySlug(facets, "people");

		expect(facet).toBeDefined();
		expect(facet?.id).toBe("2");
		expect(facet?.name).toBe("People");
	});

	it("returns undefined when slug not found", () => {
		const facets = [mkFacet("1", "Media", "media")];

		const facet = findFacetBySlug(facets, "nonexistent");

		expect(facet).toBeUndefined();
	});

	it("returns undefined for empty facets array", () => {
		const facet = findFacetBySlug([], "any-slug");

		expect(facet).toBeUndefined();
	});
});

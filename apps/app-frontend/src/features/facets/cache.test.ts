import { describe, expect, it } from "bun:test";
import { applyFacetEnabledPatch, applyFacetReorderPatch } from "./cache";
import { createFacetFixture } from "./test-fixtures";

const f = createFacetFixture;
const facet = (
	id: string,
	name: string,
	slug: string,
	sortOrder = 1,
	enabled = true,
) => f({ id, name, slug, enabled, sortOrder });

describe("applyFacetEnabledPatch", () => {
	it("updates target facet enabled status only", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2, false),
			facet("3", "Music", "music", 3),
		];

		const result = applyFacetEnabledPatch(facets, "2", true);

		expect(result[0]).toEqual(facets[0]);
		expect(result[1]?.enabled).toBe(true);
		expect(result[1]?.id).toBe("2");
		expect(result[2]).toEqual(facets[2]);
	});

	it("maintains immutability of input array", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2, false),
		];

		const originalEnabled = facets[0]?.enabled;
		const result = applyFacetEnabledPatch(facets, "1", false);

		expect(facets[0]?.enabled).toBe(originalEnabled);
		expect(result[0]?.enabled).toBe(false);
		expect(result).not.toBe(facets);
	});

	it("maintains immutability of facet objects", () => {
		const facets = [facet("1", "Media", "media")];

		const result = applyFacetEnabledPatch(facets, "1", false);

		expect(result[0]).not.toBe(facets[0]);
	});
});

describe("applyFacetReorderPatch", () => {
	it("applies requested order to facets", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2),
			facet("3", "Music", "music", 3),
		];

		const result = applyFacetReorderPatch(facets, ["3", "1", "2"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
	});

	it("reassigns sortOrder starting at 1", () => {
		const facets = [
			facet("1", "Media", "media", 10),
			facet("2", "People", "people", 20),
			facet("3", "Music", "music", 30),
		];

		const result = applyFacetReorderPatch(facets, ["2", "3", "1"]);

		expect(result[0]?.sortOrder).toBe(1);
		expect(result[1]?.sortOrder).toBe(2);
		expect(result[2]?.sortOrder).toBe(3);
	});

	it("ignores unknown ids safely", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2),
		];

		const result = applyFacetReorderPatch(facets, ["1", "999", "2"]);

		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe("1");
		expect(result[1]?.id).toBe("2");
	});

	it("appends unspecified facets in prior relative order", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2),
			facet("3", "Music", "music", 3),
			facet("4", "Books", "books", 4),
		];

		const result = applyFacetReorderPatch(facets, ["3", "1"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
		expect(result[3]?.id).toBe("4");
	});

	it("maintains immutability of input array", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2),
		];

		const result = applyFacetReorderPatch(facets, ["2", "1"]);

		expect(result).not.toBe(facets);
		expect(facets[0]?.id).toBe("1");
		expect(facets[1]?.id).toBe("2");
	});

	it("maintains immutability of facet objects", () => {
		const facets = [
			facet("1", "Media", "media"),
			facet("2", "People", "people", 2),
		];

		const result = applyFacetReorderPatch(facets, ["2", "1"]);

		expect(result[0]).not.toBe(facets[1]);
		expect(result[1]).not.toBe(facets[0]);
	});
});

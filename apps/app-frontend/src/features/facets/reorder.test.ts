import { describe, expect, test } from "bun:test";
import { moveFacet } from "./reorder";

describe("moveFacet", () => {
	test("moves facet up by one position", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, "b", "up");
		expect(result).toEqual(["b", "a", "c"]);
	});

	test("moves facet down by one position", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, "b", "down");
		expect(result).toEqual(["a", "c", "b"]);
	});

	test("returns original order when moving up from top", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, "a", "up");
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("returns original order when moving down from bottom", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, "c", "down");
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("returns original order when facetId is not found", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, "x", "up");
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("returns original order when facetId is undefined", () => {
		const facetIds = ["a", "b", "c"];
		const result = moveFacet(facetIds, undefined, "up");
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("does not mutate input array", () => {
		const facetIds = ["a", "b", "c"];
		const originalArray = [...facetIds];
		moveFacet(facetIds, "b", "up");
		expect(facetIds).toEqual(originalArray);
	});
});

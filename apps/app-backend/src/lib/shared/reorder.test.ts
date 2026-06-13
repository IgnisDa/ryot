import { describe, expect, it } from "vitest";

import { buildReorderedIds } from "./reorder";

describe("buildReorderedIds", () => {
	it("preserves the order of the requested ids", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b", "c"],
			requestedIds: ["c", "a"],
		});
		expect(result).toEqual(["c", "a", "b"]);
	});

	it("deduplicates requested ids, keeping first occurrence", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b"],
			requestedIds: ["a", "a", "b"],
		});
		expect(result).toEqual(["a", "b"]);
	});

	it("appends current ids not present in the request", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b", "c"],
			requestedIds: ["b"],
		});
		expect(result).toEqual(["b", "a", "c"]);
	});

	it("returns only deduplicated requested ids when all current ids are covered", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b"],
			requestedIds: ["b", "a"],
		});
		expect(result).toEqual(["b", "a"]);
	});

	it("returns all current ids as trailing when request is empty", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b", "c"],
			requestedIds: [],
		});
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("includes requested ids even when absent from current ids", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b"],
			requestedIds: ["c", "a"],
		});
		expect(result).toEqual(["c", "a", "b"]);
	});

	it("returns an empty array when both inputs are empty", () => {
		const result = buildReorderedIds({ currentIds: [], requestedIds: [] });
		expect(result).toEqual([]);
	});
});

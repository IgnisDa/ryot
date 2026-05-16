import { describe, expect, it } from "vitest";

import { buildReorderedIds } from "./reorder";

describe("buildReorderedIds", () => {
	it("places requested IDs first in order", () => {
		const result = buildReorderedIds({
			requestedIds: ["c", "a"],
			currentIds: ["a", "b", "c"],
		});

		expect(result).toEqual(["c", "a", "b"]);
	});

	it("appends current IDs absent from request as trailing", () => {
		const result = buildReorderedIds({
			requestedIds: ["b"],
			currentIds: ["a", "b", "c"],
		});

		expect(result).toEqual(["b", "a", "c"]);
	});

	it("deduplicates requested IDs keeping first occurrence", () => {
		const result = buildReorderedIds({
			currentIds: ["a", "b"],
			requestedIds: ["a", "a", "b"],
		});

		expect(result).toEqual(["a", "b"]);
	});

	it("returns all current IDs as trailing when requestedIds is empty", () => {
		const result = buildReorderedIds({
			requestedIds: [],
			currentIds: ["a", "b", "c"],
		});

		expect(result).toEqual(["a", "b", "c"]);
	});

	it("includes requested IDs absent from currentIds", () => {
		const result = buildReorderedIds({
			currentIds: ["a"],
			requestedIds: ["b", "a"],
		});

		expect(result).toEqual(["b", "a"]);
	});
});

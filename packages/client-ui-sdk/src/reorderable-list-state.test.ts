import { describe, expect, it } from "vitest";

import { createReorderPositions, moveReorderPosition } from "./reorderable-list-state";

describe("moveReorderPosition", () => {
	it("shifts the intervening items up when an item moves to the last slot", () => {
		const positions = createReorderPositions(["a", "b", "c"]);

		expect(moveReorderPosition({ positions, toIndex: 2, fromIndex: 0 })).toEqual({
			a: 2,
			b: 0,
			c: 1,
		});
	});

	it("shifts the intervening items down when an item moves to the first slot", () => {
		const positions = createReorderPositions(["a", "b", "c"]);

		expect(moveReorderPosition({ positions, toIndex: 0, fromIndex: 2 })).toEqual({
			a: 1,
			b: 2,
			c: 0,
		});
	});

	it("returns the same positions for a move that changes nothing", () => {
		const positions = createReorderPositions(["a", "b", "c"]);

		expect(moveReorderPosition({ positions, toIndex: 1, fromIndex: 1 })).toBe(positions);
	});
});

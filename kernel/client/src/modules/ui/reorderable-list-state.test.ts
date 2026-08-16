import { describe, expect, it } from "vitest";

import { createReorderPositions, moveReorderPosition } from "./reorderable-list-state";

const positions = createReorderPositions(["one", "two", "three", "four"]);

describe("moveReorderPosition", () => {
	it("moves an item to the last slot and shifts intervening items up", () => {
		expect(moveReorderPosition({ positions, fromIndex: 0, toIndex: 3 })).toEqual({
			one: 3,
			two: 0,
			four: 2,
			three: 1,
		});
	});

	it("moves an item to the first slot and shifts intervening items down", () => {
		expect(moveReorderPosition({ positions, fromIndex: 3, toIndex: 0 })).toEqual({
			one: 1,
			two: 2,
			four: 0,
			three: 3,
		});
	});

	it("keeps the same positions for a no-op move", () => {
		expect(moveReorderPosition({ positions, fromIndex: 2, toIndex: 2 })).toBe(positions);
	});
});

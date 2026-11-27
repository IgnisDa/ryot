import { describe, expect, it } from "bun:test";

import { fromScale, ratingRange, scaledRangeBound, toScale } from "./rating-scale";

describe("rating scales", () => {
	it("converts stored ratings to and from each scale", () => {
		expect(toScale(73, "hundred")).toBe(73);
		expect(toScale(73, "ten")).toBe(7.3);
		expect(toScale(70, "five")).toBe(3.5);
		expect(fromScale(7.3, "ten")).toBe(73);
		expect(fromScale(0.7, "ten")).toBe(7);
		expect(fromScale(3.5, "five")).toBe(70);
		expect(fromScale(0, "hundred")).toBe(0);
		expect([0, 1, 2].map((value) => fromScale(value, "three-point"))).toEqual([0, 50, 100]);
	});

	it("buckets three-point ratings at thirds of the stored range", () => {
		expect(
			[0, 33.33, 100 / 3, 50, 66.66, 200 / 3, 100].map((rating) => toScale(rating, "three-point")),
		).toEqual([0, 0, 1, 1, 1, 2, 2]);
	});

	it("maps scaled filter bounds to stored ranges and back", () => {
		expect(ratingRange(7.5, "ten")).toEqual({ min: 75, max: 75 });
		expect(ratingRange(1, "three-point")).toEqual({ min: 100 / 3, max: 200 / 3 });
		expect(ratingRange(2, "three-point")).toEqual({ max: 100, min: 200 / 3 });
		expect(scaledRangeBound(75, "max", "ten")).toBe(7.5);
		for (const value of [0, 1, 2]) {
			const range = ratingRange(value, "three-point");
			expect(scaledRangeBound(range.min, "min", "three-point")).toBe(value);
			expect(scaledRangeBound(range.max, "max", "three-point")).toBe(value);
		}
	});
});

import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { MEASUREMENT_SERIES_BATCH_SIZE, measurementSeriesRecipe } from "./measurement-recipes";

const window = {
	bucket: "day" as const,
	endAt: "2026-01-04T00:00:00.000Z",
	startAt: "2026-01-01T00:00:00.000Z",
};

const series = (values: readonly number[]) => ({
	type: "timeSeries",
	buckets: values.map((value, index) => ({
		value,
		endAt: `2026-01-0${index + 2}T00:00:00.000Z`,
		startAt: `2026-01-0${index + 1}T00:00:00.000Z`,
	})),
});

describe("measurementSeriesRecipe", () => {
	it("keeps only buckets that contain readings, since empty buckets are zero filled", () => {
		const recipe = measurementSeriesRecipe({ ...window, metricIds: ["weight", "waist"] });
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					count0: series([0, 2, 0]),
					count1: series([1, 0, 0]),
					average1: series([80, 0, 0]),
					average0: series([0, 73.5, 0]),
				},
			}),
		);
		expect(decoded).toEqual([
			{ metricId: "weight", points: [{ value: 73.5, at: "2026-01-02T00:00:00.000Z" }] },
			{ metricId: "waist", points: [{ value: 80, at: "2026-01-01T00:00:00.000Z" }] },
		]);
	});

	it("keeps a full batch within the document query limit", () => {
		const metricIds = Array.from(
			{ length: MEASUREMENT_SERIES_BATCH_SIZE },
			(_, index) => `m${index}`,
		);
		expect(
			Object.keys(measurementSeriesRecipe({ ...window, metricIds }).document.queries).length,
		).toBeLessThanOrEqual(10);
	});
});

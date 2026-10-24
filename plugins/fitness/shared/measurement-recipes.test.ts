import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { MEASUREMENT_SERIES_BATCH_SIZE, measurementSeriesRecipe } from "./measurement-recipes";

const window = {
	timeZone: "UTC",
	bucket: "day" as const,
	endAt: "2026-01-04T00:00:00.000Z",
	startAt: "2026-01-01T00:00:00.000Z",
};

describe("measurementSeriesRecipe", () => {
	it("preserves recorded zero and missing days without fabricating measurements", () => {
		const recipe = measurementSeriesRecipe({
			reference: { kind: "self" },
			...window,
			metricIds: ["weight", "waist"],
		});
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					average1: { type: "aggregate", items: [{ value: 0, at: "2026-01-01T00:00:00.000Z" }] },
					average0: { type: "aggregate", items: [{ value: 73.5, at: "2026-01-02T00:00:00.000Z" }] },
				},
			}),
		);
		expect(decoded).toEqual([
			{ metricId: "weight", points: [{ value: 73.5, at: "2026-01-02T00:00:00.000Z" }] },
			{ metricId: "waist", points: [{ value: 0, at: "2026-01-01T00:00:00.000Z" }] },
		]);
	});
	it("rejects a truncated trend instead of showing a partial history", () => {
		const recipe = measurementSeriesRecipe({
			...window,
			metricIds: ["weight"],
			reference: { kind: "self" },
		});
		expect(
			Result.isFailure(
				recipe.decode({
					data: {
						average0: {
							items: [],
							type: "aggregate",
							pageInfo: { limit: 900, hasMore: true, nextCursor: "next" },
						},
					},
				}),
			),
		).toBe(true);
	});

	it("keeps a full batch within the document query limit", () => {
		const metricIds = Array.from(
			{ length: MEASUREMENT_SERIES_BATCH_SIZE },
			(_, index) => `m${index}`,
		);
		expect(
			Object.keys(
				measurementSeriesRecipe({ reference: { kind: "self" }, ...window, metricIds }).document
					.queries,
			).length,
		).toBeLessThanOrEqual(10);
	});
});

import { describe, expect, it } from "bun:test";

import { addCalendarDays } from "@ryot-app/contract/modules/analytics/calendar";
import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";

import { MEASUREMENT_SERIES_BATCH_SIZE, measurementSeriesRecipe } from "./measurement-recipes";

describe("measurementSeriesRecipe", () => {
	it("preserves recorded zero and missing days without fabricating measurements", () => {
		const recipe = bindRecipe(measurementSeriesRecipe({ reference: { kind: "self" } }), {
			metricIds: ["weight", "waist"],
		});
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					metrics: rowsResult([{ id: "weight" }, { id: "waist" }], {
						limit: 2,
						hasMore: false,
						nextCursor: null,
					}),
					averages: {
						type: "aggregate",
						pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
						items: [
							{ value: 73.5, metricId: "weight", at: "2026-01-02T00:00:00.000Z" },
							{ value: 0, metricId: "waist", at: "2026-01-01T00:00:00.000Z" },
						],
					},
				},
			}),
		);
		expect(decoded).toEqual([
			{ metricId: "weight", points: [{ value: 73.5, at: "2026-01-02T00:00:00.000Z" }] },
			{ metricId: "waist", points: [{ value: 0, at: "2026-01-01T00:00:00.000Z" }] },
		]);
	});
	it("retains both complete 366-bucket histories across leap-day, DST and year boundaries", () => {
		const recipe = measurementSeriesRecipe({ reference: { kind: "self" } });
		const metricIds = ["weight", "waist"];
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					metrics: rowsResult(
						metricIds.map((id) => ({ id })),
						{ limit: 2, hasMore: false, nextCursor: null },
					),
					averages: {
						type: "aggregate",
						pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
						items: metricIds.flatMap((metricId) =>
							Array.from({ length: 366 }, (_, index) => ({
								metricId,
								value: index,
								at: addCalendarDays("2023-03-12", index),
							})),
						),
					},
				},
			}),
		);
		expect(decoded.map((series) => series.metricId)).toEqual(metricIds);
		for (const series of decoded) {
			expect(series.points).toHaveLength(366);
			expect(new Set(series.points.map(({ at }) => at)).size).toBe(366);
			expect(series.points[0]).toEqual({ value: 0, at: "2023-03-12" });
			expect(series.points.at(-1)).toEqual({ value: 365, at: "2024-03-11" });
		}
	});

	it("rejects a truncated trend instead of showing a partial history", () => {
		const recipe = bindRecipe(measurementSeriesRecipe({ reference: { kind: "self" } }), {
			metricIds: ["weight"],
		});
		expect(
			Result.isFailure(
				recipe.decode({
					data: {
						metrics: rowsResult([{ id: "weight" }], { limit: 2, hasMore: false, nextCursor: null }),
						averages: {
							items: [],
							type: "aggregate",
							pageInfo: { limit: 900, hasMore: true, nextCursor: "next" },
						},
					},
				}),
			),
		).toBe(true);
	});

	it("rejects a paged metric response instead of silently dropping a selected metric", () => {
		const recipe = measurementSeriesRecipe({ reference: { kind: "self" } });
		expect(
			Result.isFailure(
				recipe.decode({
					data: {
						metrics: rowsResult([{ id: "weight" }], {
							limit: 1,
							hasMore: true,
							nextCursor: "remaining-metric",
						}),
						averages: {
							type: "aggregate",
							pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
							items: [
								{ value: 0, at: "2026-01-01", metricId: "weight" },
								{ value: 1, at: "2026-01-01", metricId: "waist" },
							],
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
				bindRecipe(measurementSeriesRecipe({ reference: { kind: "self" } }), {
					metricIds: metricIds,
				}).document.queries,
			).length,
		).toBeLessThanOrEqual(10);
	});
});

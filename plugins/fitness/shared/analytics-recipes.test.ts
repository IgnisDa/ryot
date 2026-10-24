import { Result } from "@ryot-app/plugin-kit/effect";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessMeasurementTrendRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "./analytics-recipes";

const recipe = fitnessAnalyticsTotalsRecipe({
	reference: { kind: "self" },
	timeZone: TimeZone.make("UTC"),
	now: Date.parse("2026-10-01T00:00:00.000Z"),
	selection: {
		grouping: "auto",
		comparison: "none",
		range: { kind: "custom", endDate: "2026-12-31", startDate: "2026-01-01" },
	},
});
const aggregate = (item: Record<string, unknown>) => ({ items: [item], type: "aggregate" });
const decode = (pendingSets: number, failedSets = 0, matchedRows = 4, distinctSets = 4) =>
	Result.getOrThrow(
		recipe.decode({
			data: {
				entries: aggregate({ entries: 2 }),
				readings: aggregate({ readings: 5 }),
				evidenceIntegrity: aggregate({ matchedRows, distinctSets }),
				workouts: aggregate({
					workouts: 3,
					calories: 0,
					activeDays: 2,
					timedWorkouts: 1,
					activeDuration: 0,
					calorieWorkouts: 1,
				}),
				sets: aggregate({
					sets: 4,
					failedSets,
					volume: 200,
					pendingSets,
					distance: null,
					taxonomySets: 3,
					repetitions: 40,
					plannedRest: 120,
					personalBests: 4,
					setDuration: null,
					personalBestSets: 1,
					legacyTaxonomySets: 2,
				}),
			},
		}),
	);

describe("fitness analytics totals", () => {
	it("rejects duplicate evidence instead of returning inflated totals", () => {
		expect(() => decode(0, 0, 5)).toThrow("Workout occurrence evidence is ambiguous");
	});
	it("rejects disagreement between metric and integrity counts", () => {
		expect(() => decode(0, 0, 5, 5)).toThrow("Workout occurrence evidence is ambiguous");
	});
	it("keeps zero duration, missing coverage, set time and planned rest separate", () => {
		const totals = decode(0);
		expect(totals.activeDuration).toBe(0);
		expect(totals.missingDurationWorkouts).toBe(2);
		expect(totals.setDuration).toBeNull();
		expect(totals.plannedRest).toBe(120);
		expect(totals.missingCalorieWorkouts).toBe(2);
		expect(totals.missingTaxonomySets).toBe(1);
		expect(totals.legacyTaxonomySets).toBe(2);
	});
	it("reports awards versus awarded sets and entries versus individual readings", () => {
		const totals = decode(0);
		expect([totals.personalBests, totals.personalBestSets]).toEqual([4, 1]);
		expect([totals.measurementEntries, totals.measurementReadings]).toEqual([2, 5]);
	});
	it("does not report incomplete projection work as zero or a complete subtotal", () => {
		for (const totals of [decode(1), decode(0, 1)]) {
			expect(totals.personalBests).toBeNull();
			expect(totals.personalBestSets).toBeNull();
			expect(totals.volume).toBeNull();
			expect(totals.sets).toBe(4);
		}
	});
});

const input = {
	reference: { kind: "self" },
	timeZone: TimeZone.make("America/New_York"),
	now: Date.parse("2026-11-01T18:00:00.000Z"),
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { days: 7, kind: "rolling" },
	},
} as const;

describe("fitness analytics trends", () => {
	it("rejects ranking set fanout from duplicate occurrence evidence", () => {
		const ranking = historicalFitnessRankingRecipe({ ...input, kind: "targets" });
		const result = ranking.decode({
			data: {
				ranking: {
					type: "rows",
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
					items: [
						{
							sets: 10,
							workouts: 1,
							id: "target",
							name: "Target",
							evidenceSets: 5,
							weightedSets: 10,
							exerciseOccurrences: 2,
						},
					],
				},
			},
		});
		expect(Result.isFailure(result)).toBe(true);
	});
	it("hides partial derived buckets and preserves entered measurements and truncation", () => {
		for (const metric of ["volume", "repetitions"] as const) {
			const result = Result.getOrThrow(
				fitnessAnalyticsTrendRecipe({ ...input, metric }).decode({
					data: {
						trend: {
							type: "aggregate",
							pageInfo: { limit: 1000, hasMore: true },
							items: [
								{
									value: 500,
									failedSets: 0,
									knownValues: 1,
									pendingSets: 1,
									observations: 2,
									at: "2026-11-01T04:00:00.000Z",
								},
							],
						},
					},
				}),
			);
			expect(result.hasMore).toBe(true);
			expect(result.points[0]?.value).toBe(metric === "volume" ? null : 500);
			expect(result.period).toMatchObject({
				endAt: "2026-11-02T05:00:00.000Z",
				startAt: "2026-10-26T04:00:00.000Z",
			});
		}
	});
	it("reports workout starts in 24 hours without claiming timed sets", () => {
		const result = Result.getOrThrow(
			fitnessWorkoutStartsByHourRecipe(input).decode({
				data: {
					hours: {
						type: "aggregate",
						pageInfo: { limit: 24, hasMore: false },
						items: [
							{ hour: 1, starts: 2 },
							{ hour: 18, starts: 1 },
						],
					},
				},
			}),
		);
		expect(result.label).toBe("Workout starts");
		expect(result.hours).toHaveLength(24);
		expect(result.hours[1]).toEqual({ hour: 1, starts: 2 });
		expect(result.hours[2]).toEqual({ hour: 2, starts: 0 });
	});
	it("keeps per-metric units, recorded zero, and missing-day gaps", () => {
		const result = Result.getOrThrow(
			fitnessMeasurementTrendRecipe({ ...input, metricId: "weight" }).decode({
				data: {
					trend: {
						type: "aggregate",
						pageInfo: { limit: 1000, hasMore: false },
						items: [
							{ value: 0, unit: "kg", readings: 1, at: "2026-10-29T04:00:00.000Z" },
							{ value: 70, unit: "kg", readings: 2, at: "2026-11-01T04:00:00.000Z" },
						],
					},
				},
			}),
		);
		expect(result.points.map(({ unit, value }) => [value, unit])).toEqual([
			[0, "kg"],
			[70, "kg"],
		]);
		expect(result.points).toHaveLength(2);
	});
});

import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
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
const decode = (pendingSets: number, failedSets = 0) =>
	Result.getOrThrow(
		recipe.decode({
			data: {
				entries: aggregate({ entries: 2 }),
				readings: aggregate({ readings: 5 }),
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

describe("fitness rankings", () => {
	it.each(["targets", "equipment", "exercises"] as const)(
		"ranks %s with one grouped aggregate over occurrences and resumes from a cursor",
		(kind) => {
			const ranking = historicalFitnessRankingRecipe({
				kind,
				after: "opaque",
				reference: { kind: "self" },
				timeZone: TimeZone.make("UTC"),
				now: Date.parse("2026-10-01T00:00:00.000Z"),
				selection: { grouping: "auto", comparison: "none", range: { days: 30, kind: "rolling" } },
			});
			const query = ranking.document.queries["ranking"];
			expect(
				validateRyotQLDocument(ranking.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
			expect(query?.from.alias).toBe("rankOccurrence");
			expect(query?.output).toMatchObject({
				limit: 100,
				after: "opaque",
				type: "aggregate",
				orderBy: [
					{ direction: "desc", key: "weightedSets" },
					{ key: "id", direction: "asc" },
				],
			});
			expect(JSON.stringify(query?.joins).includes("jsonElements")).toBe(kind !== "exercises");
			expect(JSON.stringify(query)).not.toContain("startedAt");
			const item = {
				id: "a",
				sets: 2,
				name: "A",
				workouts: 1,
				weightedSets: 2,
				exerciseOccurrences: 1,
			};
			expect(
				Result.getOrThrow(
					ranking.decode({
						data: {
							ranking: {
								items: [item],
								type: "aggregate",
								pageInfo: { limit: 100, hasMore: true, nextCursor: "next" },
							},
						},
					}),
				),
			).toEqual({ items: [item], pageInfo: { limit: 100, hasMore: true, nextCursor: "next" } });
		},
	);
});

describe("fitness analytics totals", () => {
	it("keeps zero duration, missing coverage, set time and planned rest separate", () => {
		const totals = decode(0);
		expect(totals.activeDuration).toBe(0);
		expect(totals.missingDurationWorkouts).toBe(2);
		expect(totals.setDuration).toBeNull();
		expect(totals.plannedRest).toBe(120);
		expect(totals.missingCalorieWorkouts).toBe(2);
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
	it("hides partial derived buckets and preserves entered measurements", () => {
		for (const metric of ["volume", "repetitions"] as const) {
			const result = Result.getOrThrow(
				fitnessAnalyticsTrendRecipe({ ...input, metric }).decode({
					data: {
						setTrend: {
							type: "aggregate",
							pageInfo: { limit: 366, hasMore: false, nextCursor: null },
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
			expect(result.points[0]?.value).toBe(metric === "volume" ? null : 500);
			expect(result.period).toMatchObject({
				endAt: "2026-11-02T05:00:00.000Z",
				startAt: "2026-10-26T04:00:00.000Z",
			});
		}
	});
	it("reads workout metrics without set projection coverage", () => {
		const trend = fitnessAnalyticsTrendRecipe({ ...input, metric: "activeDuration" });
		expect(Object.keys(trend.document.queries)).toEqual(["workoutTrend"]);
		const result = Result.getOrThrow(
			trend.decode({
				data: {
					workoutTrend: {
						type: "aggregate",
						pageInfo: { limit: 366, hasMore: false, nextCursor: null },
						items: [{ value: 60, knownValues: 1, observations: 1, at: "2026-11-01T04:00:00.000Z" }],
					},
				},
			}),
		);
		expect(result.points).toEqual([
			{ value: 60, knownValues: 1, observations: 1, at: "2026-11-01T04:00:00.000Z" },
		]);
	});
	it("reports workout starts in 24 hours without claiming timed sets", () => {
		const result = Result.getOrThrow(
			fitnessWorkoutStartsByHourRecipe(input).decode({
				data: {
					hours: {
						type: "aggregate",
						pageInfo: { limit: 24, hasMore: false, nextCursor: null },
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
						pageInfo: { limit: 366, hasMore: false, nextCursor: null },
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

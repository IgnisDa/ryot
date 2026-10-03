import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { workoutSummaryRecipe, workoutWeeksRecipe } from "./workout-list-recipes";

const aggregate = (items: readonly Record<string, unknown>[]) => ({ items, type: "aggregate" });
const range = { endAt: "2026-10-18T00:00:00.000Z", startAt: "2026-09-18T00:00:00.000Z" };
const workoutTotals = (workouts: number, activeDuration: number | null, timedWorkouts: number) => ({
	workouts,
	timedWorkouts,
	activeDuration,
});

describe("workoutWeeksRecipe", () => {
	it("merges set totals into workout weeks and zero-fills weeks without sets", () => {
		const recipe = workoutWeeksRecipe({
			...range,
			search: "",
			timeZone: "UTC",
			reference: { kind: "self" },
		});
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					sets: aggregate([{ volume: 9000, personalBests: 2, at: "2026-10-05T00:00:00.000Z" }]),
					workouts: aggregate([
						{ at: "2026-10-05T00:00:00.000Z", ...workoutTotals(2, 5400, 2) },
						{ at: "2026-10-12T00:00:00.000Z", ...workoutTotals(1, null, 0) },
					]),
				},
			}),
		);
		expect(decoded).toEqual([
			{
				workouts: 2,
				volume: 9000,
				personalBests: 2,
				timedWorkouts: 2,
				activeDuration: 5400,
				at: "2026-10-05T00:00:00.000Z",
			},
			{
				volume: 0,
				workouts: 1,
				personalBests: 0,
				timedWorkouts: 0,
				activeDuration: 0,
				at: "2026-10-12T00:00:00.000Z",
			},
		]);
	});
});

describe("workoutSummaryRecipe", () => {
	const recipe = workoutSummaryRecipe({
		days: range,
		current: range,
		previous: range,
		timeZone: "UTC",
		reference: { kind: "self" },
	});

	it("stays within the document query limit", () => {
		expect(Object.keys(recipe.document.queries).length).toBeLessThanOrEqual(10);
	});

	it("treats a period without sets or records as zero volume and no latest record", () => {
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					daySets: aggregate([]),
					dayWorkouts: aggregate([]),
					currentWorkouts: aggregate([workoutTotals(3, 9000, 3)]),
					previousWorkouts: aggregate([workoutTotals(0, null, 0)]),
					currentSets: aggregate([{ volume: 12000, personalBests: 1 }]),
					previousSets: aggregate([{ volume: null, personalBests: null }]),
					latestRecord: {
						items: [],
						type: "rows",
						pageInfo: { limit: 1, hasMore: false, nextCursor: null },
					},
				},
			}),
		);
		expect(decoded).toEqual({
			days: [],
			latestRecord: null,
			previous: { volume: 0, workouts: 0, personalBests: 0, timedWorkouts: 0, activeDuration: 0 },
			current: {
				workouts: 3,
				volume: 12000,
				personalBests: 1,
				timedWorkouts: 3,
				activeDuration: 9000,
			},
		});
	});
});

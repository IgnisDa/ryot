import { describe, expect, it } from "vitest";

import { workoutSet } from "../tests/client/workout-fixtures";
import { countMuscleSets, muscleSetWeight, summarizeRecordedSets } from "./fitness-metrics";
import { awardWorkoutPersonalBests, calculateWorkoutSetStatistics } from "./workout-records";

describe("canonical fitness metrics", () => {
	it("keeps equally named targets separate while combining the same identity", () => {
		expect(
			countMuscleSets([
				{
					sets: 2,
					targets: [
						{ id: "a", role: "primary", name: "Shared name" },
						{ id: "b", role: "secondary", name: "Shared name" },
					],
				},
				{ sets: 1, targets: [{ id: "a", role: null, name: "Shared name" }] },
			]),
		).toEqual([
			{ id: "a", sets: 3, name: "Shared name" },
			{ id: "b", sets: 1, name: "Shared name" },
		]);
	});
	it("uses recorded kinds and hides stale projections without hiding entered measurements", () => {
		const sets = [
			workoutSet({ reps: 7, volume: 400, duration: 90, restTime: 20, exerciseKind: "reps" }),
			workoutSet({ reps: 5, volume: 100, restTime: 30, personalBests: ["reps", "volume"] }),
		];
		expect(summarizeRecordedSets(sets)).toEqual({
			sets: 2,
			volume: 100,
			distance: 0,
			setDuration: 0,
			repetitions: 12,
			plannedRest: 50,
			personalBests: 2,
			personalBestSets: 1,
		});
		for (const recordStatus of ["pending", "failed"] as const) {
			expect(
				summarizeRecordedSets(sets.map((set) => Object.assign({}, set, { recordStatus }))),
			).toEqual({
				sets: 2,
				distance: 0,
				volume: null,
				setDuration: 0,
				repetitions: 12,
				plannedRest: 50,
				personalBests: null,
				personalBestSets: null,
			});
		}
	});
	it("counts awards separately from sets and uses kind-aware weight volume", () => {
		const measurements = { reps: 10, weight: 20, distance: 1, duration: 60 };
		const result = awardWorkoutPersonalBests("reps_and_weight", measurements, {});
		expect(result.personalBests).toEqual(["reps", "one_rm", "volume", "weight"]);
		expect(calculateWorkoutSetStatistics("reps_and_weight", measurements).volume).toBe(200);
		expect(calculateWorkoutSetStatistics("reps", measurements).volume).toBeUndefined();
		expect(
			awardWorkoutPersonalBests("reps_and_weight", measurements, result.maxima).personalBests,
		).toEqual([]);
	});

	it("retains the historical weighted muscle-set definition", () => {
		expect(["primary", "secondary", "stabilizer", null].map(muscleSetWeight)).toEqual([
			1, 0.5, 0, 1,
		]);
	});
});

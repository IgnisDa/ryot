import { expect, it } from "vitest";

import {
	awardWorkoutPersonalBests,
	calculateWorkoutSetStatistics,
	normalizeWorkoutMeasurements,
	recordCandidates,
} from "./workout-records";

it("normalizes base measurements and calculates only the statistics for the exercise kind", () => {
	expect(
		normalizeWorkoutMeasurements({
			reps: 10,
			duration: 2.1239,
			weight: 4.12345678,
			distance: 1.1234567899,
		}),
	).toEqual({ reps: 10, duration: 2.124, weight: 4.123457, distance: 1.12345679 });
	expect(calculateWorkoutSetStatistics("reps_and_weight", { reps: 9, weight: 25 })).toEqual({
		volume: 225,
		oneRm: 32.142857,
	});
	expect(calculateWorkoutSetStatistics("reps_and_weight", { reps: 10, weight: 25 })).toEqual({
		volume: 250,
		oneRm: 33.333333,
	});
	expect(
		calculateWorkoutSetStatistics("distance_and_duration", { distance: 5, duration: 2 }),
	).toEqual({ pace: 2.5 });
	expect(
		calculateWorkoutSetStatistics("reps_and_duration_and_distance", {
			reps: 5,
			distance: 3,
			duration: 2,
		}),
	).toEqual({ pace: 1.5 });
	expect(
		calculateWorkoutSetStatistics("reps_and_duration", { reps: 5, distance: 3, duration: 2 }),
	).toEqual({});
});

it("limits record candidates to each exercise kind and its supplied operands", () => {
	expect(recordCandidates("reps", { reps: 8, weight: 20 })).toEqual({ reps: 8 });
	expect(recordCandidates("duration", { duration: 60 })).toEqual({ time: 60 });
	expect(recordCandidates("reps_and_weight", { reps: 8, weight: 20 })).toEqual({
		reps: 8,
		weight: 20,
		volume: 160,
		one_rm: 24.827586,
	});
	expect(recordCandidates("reps_and_duration", { reps: 8, duration: 60 })).toEqual({
		reps: 8,
		time: 60,
	});
	expect(recordCandidates("distance_and_duration", { distance: 5, duration: 60 })).toEqual({
		time: 60,
		distance: 5,
		pace: 0.083333333333,
	});
	expect(
		recordCandidates("reps_and_duration_and_distance", { reps: 8, distance: 5, duration: 60 }),
	).toEqual({ reps: 8, time: 60, distance: 5, pace: 0.083333333333 });
	expect(recordCandidates("reps_and_weight", { reps: 8 })).toEqual({ reps: 8 });
});

it("does not award the Dec22 side lateral 25 x 10 tie and advances in-session maxima", () => {
	const tie = awardWorkoutPersonalBests(
		"reps_and_weight",
		{ reps: 10, weight: 25 },
		{ reps: 10, weight: 25, volume: 250, one_rm: 33.333333 },
	);
	expect(tie.personalBests).toEqual([]);
	expect(tie.maxima).toEqual({ reps: 10, weight: 25, volume: 250, one_rm: 33.333333 });

	const first = awardWorkoutPersonalBests("reps_and_weight", { reps: 8, weight: 20 }, {});
	expect(first.personalBests).toEqual(["reps", "one_rm", "volume", "weight"]);
	expect(first.maxima).toEqual({ reps: 8, weight: 20, volume: 160, one_rm: 24.827586 });

	const next = awardWorkoutPersonalBests("reps_and_weight", { reps: 10, weight: 25 }, first.maxima);
	expect(next.personalBests).toEqual(["reps", "one_rm", "volume", "weight"]);
	expect(next.maxima).toEqual({ reps: 10, weight: 25, volume: 250, one_rm: 33.333333 });
});

it("treats weights that round to the same scale as one maximum and keeps zero and missing values distinct", () => {
	const unroundedWeight = 10 * 0.45359237;
	const first = awardWorkoutPersonalBests(
		"reps_and_weight",
		{ reps: 5, weight: unroundedWeight },
		{},
	);
	const second = awardWorkoutPersonalBests(
		"reps_and_weight",
		{ reps: 5, weight: 4.5359237 },
		first.maxima,
	);
	expect(first.maxima.weight).toBe(4.535924);
	expect(second.personalBests).toEqual([]);
	expect(second.maxima.weight).toBe(4.535924);

	expect(normalizeWorkoutMeasurements({})).toEqual({});
	expect(normalizeWorkoutMeasurements({ reps: 0, weight: 0, duration: 0, distance: 0 })).toEqual({
		reps: 0,
		weight: 0,
		duration: 0,
		distance: 0,
	});
	expect(calculateWorkoutSetStatistics("reps_and_weight", { reps: 0, weight: 0 })).toEqual({});
	expect(
		calculateWorkoutSetStatistics("distance_and_duration", { distance: 0, duration: 0 }),
	).toEqual({});
	expect(recordCandidates("reps_and_weight", { reps: 0, weight: 0 })).toEqual({});
	expect(recordCandidates("distance_and_duration", { distance: 0, duration: 0 })).toEqual({});
});

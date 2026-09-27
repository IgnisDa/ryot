import { expect, it } from "vitest";

import { buildWorkoutSetEventProperties, selectWorkoutSetMeasurements } from "./workout-set";

const measurements = { reps: 5, weight: 100, distance: 2, duration: 60 };

it.each([
	["reps", { reps: 5 }],
	["duration", { duration: 60 }],
	["reps_and_weight", { reps: 5, weight: 100 }],
	["reps_and_duration", { reps: 5, duration: 60 }],
	["distance_and_duration", { distance: 2, duration: 60 }],
	["reps_and_duration_and_distance", { reps: 5, distance: 2, duration: 60 }],
] as const)("selects only measurements declared by the %s exercise kind", (kind, expected) => {
	expect(selectWorkoutSetMeasurements(kind, measurements)).toEqual(expected);
});

it("builds workout-set properties with zero values, RPE, and canonical statistics", () => {
	expect(
		buildWorkoutSetEventProperties({
			rpe: 8,
			reps: 5,
			weight: 0,
			restTime: 0,
			setOrder: 3,
			note: "Last set",
			setLot: "normal",
			exerciseOrder: 2,
			exerciseKind: "reps_and_weight",
			confirmedAt: "2026-10-15T10:00:00.000Z",
		}),
	).toEqual({
		rpe: 8,
		reps: 5,
		oneRm: 0,
		weight: 0,
		volume: 0,
		restTime: 0,
		setOrder: 3,
		note: "Last set",
		exerciseOrder: 2,
		setLot: "normal",
		exerciseKind: "reps_and_weight",
		confirmedAt: "2026-10-15T10:00:00.000Z",
	});
});

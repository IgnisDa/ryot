import type { ExerciseRecord } from "../../client/exercise/details-model";
import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import { page } from "./workout-fixtures";

export const emptyTotals: ExerciseDetails["totals"] = {
	sets: 0,
	reps: null,
	sessions: 0,
	lastAt: null,
	volume: null,
	firstAt: null,
	duration: null,
	distance: null,
	warmUpSets: null,
	failureSets: null,
	weightForReps1: null,
	weightForReps5: null,
	weightForReps8: null,
	weightForReps12: null,
	weightForReps30: null,
};

export const exerciseRecord = (
	overrides: Partial<Omit<ExerciseRecord, "equipment" | "targets">> & {
		readonly targets?: ExerciseRecord["targets"]["items"];
		readonly equipment?: ExerciseRecord["equipment"]["items"];
	} = {},
): ExerciseRecord => ({
	images: null,
	userId: null,
	force: "push",
	id: "exercise-1",
	level: "beginner",
	instructions: null,
	mechanic: "compound",
	kind: "reps_and_weight",
	name: "Barbell Bench Press",
	...overrides,
	targets: page(overrides.targets ?? []),
	equipment: page(overrides.equipment ?? []),
});

export const exerciseDetails = (
	overrides: Partial<Omit<ExerciseDetails, "exercise">> & {
		readonly exercise?: ExerciseRecord;
	} = {},
): ExerciseDetails => ({
	notes: [],
	months: [],
	sessions: [],
	setNotes: [],
	topWorkout: null,
	workoutNotes: [],
	personalBests: [],
	totals: emptyTotals,
	exercise: exerciseRecord(),
	...overrides,
});

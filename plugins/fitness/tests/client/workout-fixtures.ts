import { EntityId, EntitySchemaSlug } from "@ryot-app/plugin-kit/schema";

import type { WorkoutExercise, WorkoutSet } from "../../client/workout/details-model";
import type { WorkoutDetails } from "../../shared/workout-details-recipes";

export const page = <Item>(items: readonly Item[]) => ({
	items,
	pageInfo: { limit: 100, hasMore: false },
});

export const workoutSet = (overrides: Partial<WorkoutSet> = {}): WorkoutSet => ({
	reps: 10,
	rpe: null,
	note: null,
	weight: 20,
	oneRm: 26.7,
	volume: 200,
	id: "set-1",
	setOrder: 0,
	restTime: 60,
	duration: null,
	distance: null,
	setLot: "normal",
	exerciseOrder: 0,
	confirmedAt: null,
	personalBests: [],
	recordStatus: "ready",
	exerciseId: "exercise-1",
	exerciseKind: "reps_and_weight",
	...overrides,
});

export const workoutExercise = (
	overrides: Partial<Omit<WorkoutExercise, "sets" | "targets" | "equipment" | "previousSets">> & {
		readonly sets?: readonly WorkoutSet[];
		readonly targets?: WorkoutExercise["targets"]["items"];
		readonly equipment?: WorkoutExercise["equipment"]["items"];
		readonly previousSets?: WorkoutExercise["previousSets"]["items"];
	} = {},
): WorkoutExercise => ({
	images: null,
	id: "exercise-1",
	previousWorkoutId: null,
	defaultDurationUnit: null,
	name: "Seated Dumbbell Curl",
	previousWorkoutStartedAt: null,
	...overrides,
	targets: page(overrides.targets ?? []),
	equipment: page(overrides.equipment ?? []),
	sets: page(overrides.sets ?? [workoutSet()]),
	previousSets: page(overrides.previousSets ?? []),
});

export const workoutDetails = (
	overrides: { readonly exercises?: readonly WorkoutExercise[] } & Partial<
		Omit<WorkoutDetails, "template" | "exercises" | "repeatedFrom">
	> = {},
): WorkoutDetails => ({
	name: "Pull",
	images: null,
	videos: null,
	comment: null,
	supersets: null,
	caloriesBurnt: null,
	exerciseMedia: null,
	exerciseNotes: null,
	activeDuration: null,
	id: EntityId.make("workout-1"),
	endedAt: "2024-12-24T04:14:17.000Z",
	startedAt: "2024-12-24T02:49:09.000Z",
	schemaSlug: EntitySchemaSlug.make("workout"),
	...overrides,
	template: page([]),
	repeatedFrom: page([]),
	exercises: page(overrides.exercises ?? [workoutExercise()]),
});

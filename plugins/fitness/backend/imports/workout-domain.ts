import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { type ExerciseKind, exerciseKinds } from "../../shared/exercise-kinds";
import { WorkoutSetLotSchema } from "../../shared/workout-set";

const WorkoutImportSetSchema = Schema.Struct({
	setLot: Schema.mutableKey(WorkoutSetLotSchema),
	note: Schema.mutableKey(Schema.optional(Schema.String)),
	reps: Schema.mutableKey(Schema.optional(Schema.Finite)),
	weight: Schema.mutableKey(Schema.optional(Schema.Finite)),
	duration: Schema.mutableKey(Schema.optional(Schema.Finite)),
	distance: Schema.mutableKey(Schema.optional(Schema.Finite)),
	restTime: Schema.mutableKey(Schema.optional(Schema.Finite)),
	confirmedAt: Schema.mutableKey(Schema.optional(Schema.String)),
	restTimerStartedAt: Schema.mutableKey(Schema.optional(Schema.String)),
});

export type WorkoutImportSet = Schema.Schema.Type<typeof WorkoutImportSetSchema>;

const WorkoutImportExerciseSchema = Schema.Struct({
	name: Schema.mutableKey(Schema.String),
	kind: Schema.mutableKey(Schema.Literals([...exerciseKinds])),
	sets: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutImportSetSchema))),
});

export type WorkoutImportExercise = Schema.Schema.Type<typeof WorkoutImportExerciseSchema>;

export const WorkoutImportItemSchema = Schema.Struct({
	name: Schema.mutableKey(Schema.String),
	itemIndex: Schema.mutableKey(Schema.Finite),
	startedAt: Schema.mutableKey(Schema.String),
	sourceLabel: Schema.mutableKey(Schema.String),
	sourceIdentifier: Schema.mutableKey(Schema.String),
	endedAt: Schema.mutableKey(Schema.NullOr(Schema.String)),
	comment: Schema.mutableKey(Schema.optional(Schema.NullOr(Schema.String))),
	exercises: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutImportExerciseSchema))),
	activeDuration: Schema.mutableKey(
		Schema.optional(
			Schema.Finite.pipe(
				Schema.check(Schema.isInt()),
				Schema.check(Schema.isGreaterThanOrEqualTo(0)),
			),
		),
	),
});

export type WorkoutImportItem = Schema.Schema.Type<typeof WorkoutImportItemSchema>;

const WorkoutAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Finite,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	unit: Schema.Literals(["workouts", "exercises"]),
});

export type WorkoutAdapterFailure = Schema.Schema.Type<typeof WorkoutAdapterFailureSchema>;

const WorkoutAdapterResultSchema = Schema.Struct({
	item: Schema.optional(WorkoutImportItemSchema),
	failures: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutAdapterFailureSchema))),
});

export type WorkoutAdapterResult = Schema.Schema.Type<typeof WorkoutAdapterResultSchema>;

const hasMeaningfulValue = (value: number | undefined) =>
	value !== undefined && Number.isFinite(value) && value > 0;

export const determineWorkoutExerciseKind = (
	sets: Array<Pick<WorkoutImportSet, "distance" | "duration" | "reps" | "weight">>,
): ExerciseKind | null => {
	if (sets.length === 0) {
		return null;
	}

	const hasDistanceAndDuration = sets.some(
		(set) => hasMeaningfulValue(set.distance) && hasMeaningfulValue(set.duration),
	);
	const hasRepsAndDuration = sets.some(
		(set) => hasMeaningfulValue(set.reps) && hasMeaningfulValue(set.duration),
	);
	const hasRepsDurationAndDistance = sets.some(
		(set) =>
			hasMeaningfulValue(set.reps) &&
			hasMeaningfulValue(set.duration) &&
			hasMeaningfulValue(set.distance),
	);
	const hasDurationOnly = sets.some((set) => hasMeaningfulValue(set.duration));
	const hasRepsAndWeight = sets.some(
		(set) =>
			hasMeaningfulValue(set.reps) &&
			set.weight !== undefined &&
			Number.isFinite(set.weight) &&
			set.weight >= 0,
	);
	const hasRepsOnly = sets.some((set) => hasMeaningfulValue(set.reps));

	if (hasRepsDurationAndDistance) {
		return "reps_and_duration_and_distance";
	}
	if (hasRepsAndDuration) {
		return "reps_and_duration";
	}
	if (hasDistanceAndDuration) {
		return "distance_and_duration";
	}
	if (hasDurationOnly) {
		return "duration";
	}
	if (hasRepsAndWeight) {
		return "reps_and_weight";
	}
	if (hasRepsOnly) {
		return "reps";
	}
	return null;
};

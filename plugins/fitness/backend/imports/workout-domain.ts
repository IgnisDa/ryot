import { Schema } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { exerciseKinds, type ExerciseKind } from "../../shared/exercise-kinds";
import { calculateWorkoutSetStatistics } from "../../shared/workout-records";

const WorkoutImportSetSchema = Schema.Struct({
	note: Schema.mutableKey(Schema.optional(Schema.String)),
	reps: Schema.mutableKey(Schema.optional(Schema.Finite)),
	weight: Schema.mutableKey(Schema.optional(Schema.Finite)),
	duration: Schema.mutableKey(Schema.optional(Schema.Finite)),
	distance: Schema.mutableKey(Schema.optional(Schema.Finite)),
	restTime: Schema.mutableKey(Schema.optional(Schema.Finite)),
	confirmedAt: Schema.mutableKey(Schema.optional(Schema.String)),
	restTimerStartedAt: Schema.mutableKey(Schema.optional(Schema.String)),
	setLot: Schema.mutableKey(Schema.Literals(["normal", "warm_up", "drop", "failure"])),
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
});

export type WorkoutImportItem = Schema.Schema.Type<typeof WorkoutImportItemSchema>;

const WorkoutAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Finite,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

export type WorkoutAdapterFailure = Schema.Schema.Type<typeof WorkoutAdapterFailureSchema>;

const WorkoutAdapterResultSchema = Schema.Struct({
	items: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutImportItemSchema))),
	failures: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutAdapterFailureSchema))),
});

export type WorkoutAdapterResult = Schema.Schema.Type<typeof WorkoutAdapterResultSchema>;

const cleanWorkoutSetStats = (kind: ExerciseKind, set: WorkoutImportSet) => {
	const stats: Pick<WorkoutImportSet, "distance" | "duration" | "reps" | "weight"> = {};
	if (kind === "reps" || kind === "reps_and_weight" || kind === "reps_and_duration") {
		stats.reps = set.reps;
	}
	if (kind === "reps_and_weight") {
		stats.weight = set.weight;
	}
	if (
		kind === "duration" ||
		kind === "reps_and_duration" ||
		kind === "distance_and_duration" ||
		kind === "reps_and_duration_and_distance"
	) {
		stats.duration = set.duration;
	}
	if (kind === "distance_and_duration" || kind === "reps_and_duration_and_distance") {
		stats.distance = set.distance;
	}
	if (kind === "reps_and_duration_and_distance") {
		stats.reps = set.reps;
	}
	return stats;
};

const addNumberProperty = (
	properties: Record<string, JsonValue>,
	key: string,
	value: number | undefined,
) => {
	if (value !== undefined && Number.isFinite(value)) {
		properties[key] = value;
	}
};

export const buildWorkoutSetEventProperties = (input: {
	setOrder: number;
	set: WorkoutImportSet;
	exerciseOrder: number;
	exerciseKind: ExerciseKind;
}) => {
	const properties: Record<string, JsonValue> = {
		unitSystem: "metric",
		setLot: input.set.setLot,
		setOrder: input.setOrder,
		exerciseOrder: input.exerciseOrder,
	};
	if (input.set.note) {
		properties["note"] = input.set.note;
	}
	if (input.set.confirmedAt !== undefined) {
		properties["confirmedAt"] = input.set.confirmedAt;
	}
	if (input.set.restTime !== undefined) {
		properties["restTime"] = input.set.restTime;
	}
	if (input.set.restTimerStartedAt !== undefined) {
		properties["restTimerStartedAt"] = input.set.restTimerStartedAt;
	}
	const measurements = cleanWorkoutSetStats(input.exerciseKind, input.set);
	addNumberProperty(properties, "reps", measurements.reps);
	addNumberProperty(properties, "weight", measurements.weight);
	addNumberProperty(properties, "duration", measurements.duration);
	addNumberProperty(properties, "distance", measurements.distance);
	const statistics = calculateWorkoutSetStatistics(input.exerciseKind, measurements);
	addNumberProperty(properties, "pace", statistics.pace);
	addNumberProperty(properties, "volume", statistics.volume);
	addNumberProperty(properties, "oneRm", statistics.oneRm);
	return properties;
};

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

import { Schema } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

const workoutExerciseKinds = [
	"reps",
	"duration",
	"reps_and_weight",
	"reps_and_duration",
	"distance_and_duration",
	"reps_and_duration_and_distance",
] as const;

export type WorkoutExerciseKind = (typeof workoutExerciseKinds)[number];

const WorkoutImportSetSchema = Schema.mutable(
	Schema.Struct({
		note: Schema.optional(Schema.String),
		reps: Schema.optional(Schema.Number),
		weight: Schema.optional(Schema.Number),
		duration: Schema.optional(Schema.Number),
		distance: Schema.optional(Schema.Number),
		setLot: Schema.Literal("normal", "warm_up", "drop", "failure"),
	}),
);

export type WorkoutImportSet = typeof WorkoutImportSetSchema.Type;

const WorkoutImportExerciseSchema = Schema.mutable(
	Schema.Struct({
		name: Schema.String,
		kind: Schema.Literal(...workoutExerciseKinds),
		sets: Schema.mutable(Schema.Array(WorkoutImportSetSchema)),
	}),
);

export type WorkoutImportExercise = typeof WorkoutImportExerciseSchema.Type;

export const WorkoutImportItemSchema = Schema.mutable(
	Schema.Struct({
		name: Schema.String,
		itemIndex: Schema.Number,
		startedAt: Schema.String,
		sourceLabel: Schema.String,
		sourceIdentifier: Schema.String,
		endedAt: Schema.NullOr(Schema.String),
		comment: Schema.optional(Schema.NullOr(Schema.String)),
		exercises: Schema.mutable(Schema.Array(WorkoutImportExerciseSchema)),
	}),
);

export type WorkoutImportItem = typeof WorkoutImportItemSchema.Type;

const WorkoutAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

export type WorkoutAdapterFailure = typeof WorkoutAdapterFailureSchema.Type;

const WorkoutAdapterResultSchema = Schema.Struct({
	items: Schema.mutable(Schema.Array(WorkoutImportItemSchema)),
	failures: Schema.mutable(Schema.Array(WorkoutAdapterFailureSchema)),
});

export type WorkoutAdapterResult = typeof WorkoutAdapterResultSchema.Type;

const cleanWorkoutSetStats = (kind: WorkoutExerciseKind, set: WorkoutImportSet) => {
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
	exerciseKind: WorkoutExerciseKind;
}) => {
	const properties: Record<string, JsonValue> = {
		setLot: input.set.setLot,
		setOrder: input.setOrder,
		exerciseOrder: input.exerciseOrder,
	};
	if (input.set.note) {
		properties["note"] = input.set.note;
	}
	const stats = cleanWorkoutSetStats(input.exerciseKind, input.set);
	addNumberProperty(properties, "reps", stats.reps);
	addNumberProperty(properties, "weight", stats.weight);
	addNumberProperty(properties, "duration", stats.duration);
	addNumberProperty(properties, "distance", stats.distance);
	addNumberProperty(
		properties,
		"pace",
		input.set.distance !== undefined && input.set.duration !== undefined && input.set.duration !== 0
			? input.set.distance / input.set.duration
			: undefined,
	);
	addNumberProperty(
		properties,
		"volume",
		input.set.weight !== undefined && input.set.reps !== undefined
			? input.set.weight * input.set.reps
			: undefined,
	);
	let oneRm: number | undefined;
	if (input.set.weight !== undefined && input.set.reps !== undefined) {
		const calculated =
			input.set.reps < 10
				? (input.set.weight * 36) / (37 - input.set.reps)
				: input.set.weight * (1 + input.set.reps / 30);
		oneRm = calculated >= 0 && Number.isFinite(calculated) ? calculated : undefined;
	}
	addNumberProperty(properties, "oneRm", oneRm);
	return properties;
};

const hasMeaningfulValue = (value: number | undefined) => value !== undefined && value > 0;

export const determineWorkoutExerciseKind = (
	sets: Array<Pick<WorkoutImportSet, "distance" | "duration" | "reps" | "weight">>,
): WorkoutExerciseKind | null => {
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
		(set) => hasMeaningfulValue(set.reps) && hasMeaningfulValue(set.weight),
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

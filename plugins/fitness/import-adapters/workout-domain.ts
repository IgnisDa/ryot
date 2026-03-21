import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { Schema } from "@ryot/sandbox-sdk/effect";

const workoutExerciseKinds = [
	"reps",
	"duration",
	"reps_and_weight",
	"reps_and_duration",
	"distance_and_duration",
	"reps_and_duration_and_distance",
] as const;

export type WorkoutExerciseKind = (typeof workoutExerciseKinds)[number];

const WorkoutImportSetSchema = Schema.Struct({
	note: Schema.mutableKey(Schema.optional(Schema.String)),
	reps: Schema.mutableKey(Schema.optional(Schema.Number)),
	weight: Schema.mutableKey(Schema.optional(Schema.Number)),
	duration: Schema.mutableKey(Schema.optional(Schema.Number)),
	distance: Schema.mutableKey(Schema.optional(Schema.Number)),
	setLot: Schema.mutableKey(Schema.Literals(["normal", "warm_up", "drop", "failure"])),
});

export type WorkoutImportSet = Schema.Schema.Type<typeof WorkoutImportSetSchema>;

const WorkoutImportExerciseSchema = Schema.Struct({
	name: Schema.mutableKey(Schema.String),
	kind: Schema.mutableKey(Schema.Literals([...workoutExerciseKinds])),
	sets: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutImportSetSchema))),
});

export type WorkoutImportExercise = Schema.Schema.Type<typeof WorkoutImportExerciseSchema>;

export const WorkoutImportItemSchema = Schema.Struct({
	name: Schema.mutableKey(Schema.String),
	itemIndex: Schema.mutableKey(Schema.Number),
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
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

export type WorkoutAdapterFailure = Schema.Schema.Type<typeof WorkoutAdapterFailureSchema>;

const WorkoutAdapterResultSchema = Schema.Struct({
	items: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutImportItemSchema))),
	failures: Schema.mutableKey(Schema.mutable(Schema.Array(WorkoutAdapterFailureSchema))),
});

export type WorkoutAdapterResult = Schema.Schema.Type<typeof WorkoutAdapterResultSchema>;

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

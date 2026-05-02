import { Schema } from "effect";

import { slugify } from "#lib/slug";

export const workoutExerciseKinds = [
	"reps",
	"duration",
	"reps_and_weight",
	"reps_and_duration",
	"distance_and_duration",
	"reps_and_duration_and_distance",
] as const;

export type WorkoutExerciseKind = (typeof workoutExerciseKinds)[number];

export const WorkoutImportSetSchema = Schema.mutable(
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

export const WorkoutImportExerciseSchema = Schema.mutable(
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
		endedAt: Schema.NullOr(Schema.String),
		sourceIdentifier: Schema.String,
		comment: Schema.optional(Schema.NullOr(Schema.String)),
		exercises: Schema.mutable(Schema.Array(WorkoutImportExerciseSchema)),
	}),
);

export type WorkoutImportItem = typeof WorkoutImportItemSchema.Type;

export type WorkoutAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier: string;
};

export type WorkoutAdapterResult = {
	failures: WorkoutAdapterFailure[];
	items: WorkoutImportItem[];
};

const hasMeaningfulValue = (value: number | undefined): boolean => value !== undefined && value > 0;

export const normalizeExerciseIdentityName = (name: string): string => slugify(name);

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

const calculateWorkoutSetVolume = (input: {
	reps?: number;
	weight?: number;
}): number | undefined => {
	if (input.weight === undefined || input.reps === undefined) {
		return undefined;
	}
	return input.weight * input.reps;
};

const calculateWorkoutSetPace = (input: {
	duration?: number;
	distance?: number;
}): number | undefined => {
	if (input.distance === undefined || input.duration === undefined || input.duration === 0) {
		return undefined;
	}
	return input.distance / input.duration;
};

const calculateWorkoutSetOneRm = (input: {
	reps?: number;
	weight?: number;
}): number | undefined => {
	if (input.weight === undefined || input.reps === undefined) {
		return undefined;
	}

	const oneRm =
		input.reps < 10
			? (input.weight * 36) / (37 - input.reps)
			: input.weight * (1 + input.reps / 30);

	return oneRm >= 0 && Number.isFinite(oneRm) ? oneRm : undefined;
};

const addNumberProperty = (input: {
	key: string;
	value: number | undefined;
	properties: Record<string, unknown>;
}) => {
	if (input.value !== undefined && Number.isFinite(input.value)) {
		input.properties[input.key] = input.value;
	}
};

export const buildWorkoutSetEventProperties = (input: {
	setOrder: number;
	set: WorkoutImportSet;
	exerciseOrder: number;
	exerciseKind: WorkoutExerciseKind;
}): Record<string, unknown> => {
	const properties: Record<string, unknown> = {
		setLot: input.set.setLot,
		setOrder: input.setOrder,
		exerciseOrder: input.exerciseOrder,
	};
	if (input.set.note) {
		properties.note = input.set.note;
	}

	const stats = cleanWorkoutSetStats(input.exerciseKind, input.set);
	addNumberProperty({ key: "reps", properties, value: stats.reps });
	addNumberProperty({ key: "weight", properties, value: stats.weight });
	addNumberProperty({ key: "duration", properties, value: stats.duration });
	addNumberProperty({ key: "distance", properties, value: stats.distance });
	addNumberProperty({ key: "pace", properties, value: calculateWorkoutSetPace(input.set) });
	addNumberProperty({ key: "oneRm", properties, value: calculateWorkoutSetOneRm(input.set) });
	addNumberProperty({ key: "volume", properties, value: calculateWorkoutSetVolume(input.set) });

	return properties;
};

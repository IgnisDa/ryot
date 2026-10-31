import { Schema } from "@ryot-app/plugin-kit/effect";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import { type ExerciseKind, exerciseKindSchema } from "./exercise-kinds";
import { IsoTimestamp, NonNegativeInt, Rpe } from "./fitness-primitives";
import { WorkoutSetMeasurementsSchema } from "./workout-records";

export const workoutSetLots = ["normal", "warm_up", "drop", "failure"] as const;

export const WorkoutSetLotSchema = Schema.Literals(workoutSetLots);
export type WorkoutSetLot = typeof WorkoutSetLotSchema.Type;

export const requiredWorkoutMeasurementsByKind: Record<
	ExerciseKind,
	ReadonlyArray<keyof typeof WorkoutSetMeasurementsSchema.Type>
> = {
	reps: ["reps"],
	duration: ["duration"],
	reps_and_weight: ["reps", "weight"],
	reps_and_duration: ["reps", "duration"],
	distance_and_duration: ["distance", "duration"],
	reps_and_duration_and_distance: ["reps", "duration", "distance"],
};

export const WorkoutSetAssetLocatorSchema = Schema.Union([
	LocalAssetLocator,
	RemoteAssetLocator,
	S3AssetLocator,
]);
export const WorkoutEditorMediaSchema = Schema.Array(WorkoutSetAssetLocatorSchema);
export type WorkoutSetAssetLocator = typeof WorkoutSetAssetLocatorSchema.Type;

export const WorkoutSetPropertiesInputSchema = Schema.Struct({
	...WorkoutSetMeasurementsSchema.fields,
	setOrder: NonNegativeInt,
	rpe: Schema.optional(Rpe),
	setLot: WorkoutSetLotSchema,
	exerciseOrder: NonNegativeInt,
	exerciseKind: exerciseKindSchema,
	note: Schema.optional(Schema.String),
	restTime: Schema.optional(NonNegativeInt),
	confirmedAt: Schema.optional(IsoTimestamp),
	restTimerStartedAt: Schema.optional(IsoTimestamp),
});
export type WorkoutSetPropertiesInput = typeof WorkoutSetPropertiesInputSchema.Type;

export const workoutSetEditableFields = [
	"confirmedAt",
	"distance",
	"duration",
	"exerciseKind",
	"exerciseOrder",
	"note",
	"reps",
	"restTime",
	"restTimerStartedAt",
	"rpe",
	"setLot",
	"setOrder",
	"weight",
] as const satisfies ReadonlyArray<keyof WorkoutSetPropertiesInput>;
export const workoutSetDerivedFields = ["oneRm", "pace", "personalBests", "volume"] as const;
export type WorkoutSetField =
	(typeof workoutSetDerivedFields)[number] | (typeof workoutSetEditableFields)[number];

export const selectWorkoutSetMeasurements = (
	kind: ExerciseKind,
	measurements: typeof WorkoutSetMeasurementsSchema.Type,
): { readonly [Field in keyof typeof WorkoutSetMeasurementsSchema.Type]?: number } => {
	return Object.fromEntries(
		requiredWorkoutMeasurementsByKind[kind].flatMap((field) =>
			measurements[field] === undefined ? [] : [[field, measurements[field]]],
		),
	);
};

export const buildWorkoutSetEventProperties = (input: WorkoutSetPropertiesInput) => ({
	setLot: input.setLot,
	setOrder: input.setOrder,
	exerciseKind: input.exerciseKind,
	exerciseOrder: input.exerciseOrder,
	...(input.note === undefined ? {} : { note: input.note }),
	...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
	...(input.restTime === undefined ? {} : { restTime: input.restTime }),
	...(input.restTimerStartedAt === undefined
		? {}
		: { restTimerStartedAt: input.restTimerStartedAt }),
	...(input.rpe === undefined ? {} : { rpe: input.rpe }),
	...selectWorkoutSetMeasurements(input.exerciseKind, input),
});

export const hasTemplateSetContent = (set: {
	readonly hasRpe: boolean;
	readonly hasRest: boolean;
	readonly hasMeasurement: boolean;
	readonly note: string | undefined;
}) => set.hasMeasurement || set.hasRest || set.hasRpe || (set.note?.trim().length ?? 0) > 0;

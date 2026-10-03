import { Schema } from "@ryot-app/plugin-kit/effect";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import type { ExerciseKind } from "./exercise-kinds";
import type { WorkoutSetMeasurementsSchema } from "./workout-records";
import { calculateWorkoutSetStatistics } from "./workout-records";

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

export type WorkoutSetPropertiesInput = {
	readonly confirmedAt?: string | undefined;
	readonly distance?: number | undefined;
	readonly duration?: number | undefined;
	readonly exerciseKind: ExerciseKind;
	readonly exerciseOrder: number;
	readonly note?: string | undefined;
	readonly reps?: number | undefined;
	readonly restTime?: number | undefined;
	readonly restTimerStartedAt?: string | undefined;
	readonly rpe?: number | undefined;
	readonly setLot: WorkoutSetLot;
	readonly setOrder: number;
	readonly weight?: number | undefined;
};

export const selectWorkoutSetMeasurements = (
	kind: ExerciseKind,
	measurements: typeof WorkoutSetMeasurementsSchema.Type,
): typeof WorkoutSetMeasurementsSchema.Type => {
	return Object.fromEntries(
		requiredWorkoutMeasurementsByKind[kind].flatMap((field) =>
			measurements[field] === undefined ? [] : [[field, measurements[field]]],
		),
	);
};

const value = (input: number | undefined) =>
	input !== undefined && Number.isFinite(input) ? input : undefined;

const finiteMeasurements = (measurements: typeof WorkoutSetMeasurementsSchema.Type) => {
	const reps = value(measurements.reps);
	const weight = value(measurements.weight);
	const duration = value(measurements.duration);
	const distance = value(measurements.distance);
	return {
		...(reps === undefined ? {} : { reps }),
		...(weight === undefined ? {} : { weight }),
		...(duration === undefined ? {} : { duration }),
		...(distance === undefined ? {} : { distance }),
	};
};

export const buildWorkoutSetEventProperties = (input: WorkoutSetPropertiesInput) => {
	const measurements = finiteMeasurements(selectWorkoutSetMeasurements(input.exerciseKind, input));
	const statistics = calculateWorkoutSetStatistics(input.exerciseKind, measurements);
	return {
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
		...measurements,
		...(statistics.pace === undefined ? {} : { pace: statistics.pace }),
		...(statistics.volume === undefined ? {} : { volume: statistics.volume }),
		...(statistics.oneRm === undefined ? {} : { oneRm: statistics.oneRm }),
	};
};

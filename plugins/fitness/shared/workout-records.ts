import { Schema } from "@ryot-app/plugin-kit/effect";
import { roundHalfUp } from "@ryot-app/plugin-kit/schema";

import type { ExerciseKind } from "./exercise-kinds";

export const WorkoutSetMeasurementsSchema = Schema.Struct({
	reps: Schema.optional(Schema.Finite),
	weight: Schema.optional(Schema.Finite),
	duration: Schema.optional(Schema.Finite),
	distance: Schema.optional(Schema.Finite),
});

export type WorkoutSetMeasurements = Schema.Schema.Type<typeof WorkoutSetMeasurementsSchema>;

export const personalBestTypes = [
	"time",
	"pace",
	"reps",
	"one_rm",
	"volume",
	"weight",
	"distance",
] as const;

export const PersonalBestSchema = Schema.Literals(personalBestTypes);

export type PersonalBest = Schema.Schema.Type<typeof PersonalBestSchema>;

export const WorkoutRecordMaximaSchema = Schema.Struct({
	time: Schema.optional(Schema.Finite),
	pace: Schema.optional(Schema.Finite),
	reps: Schema.optional(Schema.Finite),
	one_rm: Schema.optional(Schema.Finite),
	volume: Schema.optional(Schema.Finite),
	weight: Schema.optional(Schema.Finite),
	distance: Schema.optional(Schema.Finite),
});

export type WorkoutRecordMaxima = Schema.Schema.Type<typeof WorkoutRecordMaximaSchema>;

export const workoutSetScales = {
	oneRm: 6,
	pace: 12,
	weight: 6,
	volume: 6,
	distance: 9,
	duration: 3,
} as const;

export const normalizeWorkoutMeasurements = (
	input: WorkoutSetMeasurements,
): WorkoutSetMeasurements => ({
	...(input.reps === undefined ? {} : { reps: input.reps }),
	...(input.weight === undefined
		? {}
		: { weight: roundHalfUp(input.weight, workoutSetScales.weight) }),
	...(input.duration === undefined
		? {}
		: { duration: roundHalfUp(input.duration, workoutSetScales.duration) }),
	...(input.distance === undefined
		? {}
		: { distance: roundHalfUp(input.distance, workoutSetScales.distance) }),
});

const normalizeDerivedValue = (value: number, scale: number) => {
	if (!Number.isFinite(value) || value < 0) {
		return undefined;
	}
	const normalized = roundHalfUp(value, scale);
	return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined;
};

export const calculateWorkoutSetStatistics = (
	kind: ExerciseKind,
	measurements: WorkoutSetMeasurements,
) => {
	const normalized = normalizeWorkoutMeasurements(measurements);
	const statistics: { oneRm?: number; volume?: number; pace?: number } = {};
	if (
		kind === "reps_and_weight" &&
		normalized.reps !== undefined &&
		normalized.reps > 0 &&
		normalized.weight !== undefined &&
		normalized.weight >= 0
	) {
		const oneRm =
			normalized.reps < 10
				? (normalized.weight * 36) / (37 - normalized.reps)
				: normalized.weight * (1 + normalized.reps / 30);
		const normalizedOneRm = normalizeDerivedValue(oneRm, workoutSetScales.oneRm);
		const normalizedVolume = normalizeDerivedValue(
			normalized.weight * normalized.reps,
			workoutSetScales.volume,
		);
		if (normalizedOneRm !== undefined) {
			statistics.oneRm = normalizedOneRm;
		}
		if (normalizedVolume !== undefined) {
			statistics.volume = normalizedVolume;
		}
	}
	if (
		(kind === "distance_and_duration" || kind === "reps_and_duration_and_distance") &&
		normalized.duration !== undefined &&
		normalized.duration > 0 &&
		normalized.distance !== undefined
	) {
		const pace = normalizeDerivedValue(
			normalized.distance / normalized.duration,
			workoutSetScales.pace,
		);
		if (pace !== undefined) {
			statistics.pace = pace;
		}
	}
	return statistics;
};

const personalBestsByKind: Record<ExerciseKind, ReadonlyArray<PersonalBest>> = {
	reps: ["reps"],
	duration: ["time"],
	reps_and_duration: ["reps", "time"],
	distance_and_duration: ["time", "pace", "distance"],
	reps_and_weight: ["reps", "one_rm", "volume", "weight"],
	reps_and_duration_and_distance: ["time", "pace", "reps", "distance"],
};

export const recordCandidates = (
	kind: ExerciseKind,
	measurements: WorkoutSetMeasurements,
): Partial<Record<PersonalBest, number>> => {
	const normalized = normalizeWorkoutMeasurements(measurements);
	const statistics = calculateWorkoutSetStatistics(kind, normalized);
	const values = {
		pace: statistics.pace,
		reps: normalized.reps,
		one_rm: statistics.oneRm,
		time: normalized.duration,
		volume: statistics.volume,
		weight: normalized.weight,
		distance: normalized.distance,
	};
	const eligible = new Set(personalBestsByKind[kind]);
	const candidates: Partial<Record<PersonalBest, number>> = {};
	for (const key of personalBestTypes) {
		const value = values[key];
		if (eligible.has(key) && value !== undefined && Number.isFinite(value) && value > 0) {
			candidates[key] = value;
		}
	}
	return candidates;
};

export const awardWorkoutPersonalBests = (
	kind: ExerciseKind,
	measurements: WorkoutSetMeasurements,
	maxima: WorkoutRecordMaxima,
) => {
	const candidates = recordCandidates(kind, measurements);
	const nextMaxima = { ...maxima };
	const personalBests = personalBestTypes.filter((key) => {
		const candidate = candidates[key];
		if (candidate === undefined || candidate <= (maxima[key] ?? 0)) {
			return false;
		}
		nextMaxima[key] = candidate;
		return true;
	});
	return { personalBests, maxima: nextMaxima };
};

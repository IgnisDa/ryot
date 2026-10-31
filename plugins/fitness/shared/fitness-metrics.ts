import {
	and,
	column,
	conditional,
	eq,
	exists,
	inArray,
	jsonArrayCount,
	literal,
	projectionStatusMeasures,
	schemaOwnerPredicate,
	selectedAggregate,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	projectionNumber,
	projectionProperty,
	property,
	propertyNumber,
} from "./entity-selections";
import { exerciseKinds } from "./exercise-kinds";
import type { WorkoutDetails } from "./workout-details-recipes";
import { requiredWorkoutMeasurementsByKind } from "./workout-set";
import type { ConvertedMeasure } from "./workout-units";

type Table = ReturnType<typeof table>;

export const fitnessMetricDefinitions = {
	sets: { unit: "sets", label: "Sets" },
	workouts: { unit: "workouts", label: "Workouts" },
	distance: { label: "Distance", measure: "distance" },
	volume: { measure: "volume", label: "Weight volume" },
	setDuration: { unit: "seconds", label: "Set duration" },
	plannedRest: { unit: "seconds", label: "Planned rest" },
	calories: { measure: "energy", label: "Recorded energy" },
	repetitions: { unit: "repetitions", label: "Repetitions" },
	personalBests: { unit: "awards", label: "Personal-best awards" },
	personalBestSets: { unit: "sets", label: "Sets with personal bests" },
	measurementEntries: { unit: "entries", label: "Measurement entries" },
	activeDuration: { unit: "seconds", label: "Recorded active duration" },
	measurementReadings: { unit: "readings", label: "Measurement readings" },
} as const satisfies Record<
	string,
	{ readonly label: string } & ({ readonly unit: string } | { readonly measure: ConvertedMeasure })
>;

export const workoutSetMetric = (set: Table, metric: "reps" | "distance" | "duration") =>
	conditional(
		inArray(
			property(set, "exerciseKind"),
			exerciseKinds
				.filter((kind) => requiredWorkoutMeasurementsByKind[kind].includes(metric))
				.map(literal),
		),
		propertyNumber(set, metric),
		literal(null),
	);

export const workoutSetVolume = (set: Table) =>
	conditional(
		eq(property(set, "exerciseKind"), literal("reps_and_weight")),
		projectionNumber(set, "volume"),
		literal(null),
	);

export const personalBestAwardCount = (set: Table) =>
	jsonArrayCount(projectionProperty(set, "personalBests"));

export const workoutSetProcessing = (
	reference: PluginIdentityReference,
	scope: { readonly workoutId?: string | undefined; readonly exerciseId?: string | undefined } = {},
) => {
	const stream = table("eventStream", "workoutSetStream");
	const set = table("event", "workoutSetStreamSet");
	return selectedAggregate(stream, {
		measures: projectionStatusMeasures(stream),
		where: and(
			schemaOwnerPredicate(stream, "eventSchemaPluginId", reference),
			eq(column(stream, "eventSchemaSlug"), literal("workout-set")),
			...(scope.exerciseId === undefined
				? []
				: [eq(column(stream, "entityId"), literal(scope.exerciseId))]),
			...(scope.workoutId === undefined
				? []
				: [
						exists(set, {
							where: and(
								eq(column(set, "entityId"), column(stream, "entityId")),
								eq(column(set, "sessionEntityId"), literal(scope.workoutId)),
								eq(column(set, "eventSchemaPluginId"), column(stream, "eventSchemaPluginId")),
								eq(column(set, "eventSchemaSlug"), literal("workout-set")),
							),
						}),
					]),
		),
	});
};

export const muscleSetWeight = (role: null | string) => {
	if (role === "stabilizer") {
		return 0;
	}
	return role === "secondary" ? 0.5 : 1;
};

type RecordedSet = WorkoutDetails["exercises"]["items"][number]["sets"]["items"][number];

export const summarizeRecordedSets = (sets: readonly RecordedSet[]) => {
	const ready = sets.every((set) => set.recordStatus === "ready");
	const measurement = (metric: "reps" | "duration" | "distance") =>
		sets.reduce(
			(total, set) =>
				total +
				(requiredWorkoutMeasurementsByKind[set.exerciseKind].includes(metric)
					? (set[metric] ?? 0)
					: 0),
			0,
		);
	return {
		sets: sets.length,
		repetitions: measurement("reps"),
		distance: measurement("distance"),
		setDuration: measurement("duration"),
		plannedRest: sets.reduce((total, set) => total + (set.restTime ?? 0), 0),
		personalBestSets: ready
			? sets.filter((set) => (set.personalBests?.length ?? 0) > 0).length
			: null,
		personalBests: ready
			? sets.reduce((total, set) => total + (set.personalBests?.length ?? 0), 0)
			: null,
		volume: ready
			? sets.reduce(
					(total, set) => total + (set.exerciseKind === "reps_and_weight" ? (set.volume ?? 0) : 0),
					0,
				)
			: null,
	};
};

export const elapsedWorkoutSeconds = (startedAt: null | string, endedAt: null | string) => {
	if (startedAt === null || endedAt === null) {
		return null;
	}
	const start = Date.parse(startedAt);
	const end = Date.parse(endedAt);
	return Number.isFinite(start) && Number.isFinite(end) && end >= start
		? (end - start) / 1000
		: null;
};

export type MuscleCount = { readonly id: string; readonly name: string; readonly sets: number };
export type MuscleSource = {
	readonly sets: number;
	readonly targets: readonly {
		readonly id: string;
		readonly name: string;
		readonly role: null | string;
	}[];
};

export const countMuscleSets = (sources: readonly MuscleSource[]): readonly MuscleCount[] => {
	const counts = new Map<string, MuscleCount>();
	for (const source of sources) {
		for (const target of source.targets) {
			const weight = muscleSetWeight(target.role);
			if (weight > 0) {
				counts.set(target.id, {
					id: target.id,
					name: target.name,
					sets: (counts.get(target.id)?.sets ?? 0) + source.sets * weight,
				});
			}
		}
	}
	return [...counts.values()].sort(
		(left, right) =>
			right.sets - left.sets ||
			left.name.localeCompare(right.name) ||
			left.id.localeCompare(right.id),
	);
};

export const countEquipmentOccurrences = (
	occurrences: readonly (readonly { readonly id: string; readonly name: string }[])[],
) => {
	const counts = new Map<string, { name: string; exercises: number }>();
	for (const equipment of occurrences) {
		for (const { id, name } of equipment) {
			counts.set(id, { name, exercises: (counts.get(id)?.exercises ?? 0) + 1 });
		}
	}
	return [...counts.values()].sort(
		(left, right) => right.exercises - left.exercises || left.name.localeCompare(right.name),
	);
};

import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castText,
	column,
	countAll,
	countIf,
	dateBucket,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	exists,
	groupAscending,
	gt,
	isNotNull,
	join,
	jsonElementsJoin,
	jsonPath,
	literal,
	localHour,
	measureDescending,
	NullableNumber,
	projectionProcessingState,
	projectionStatusMeasures,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	sumOf,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import {
	type PluginIdentityReference,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	type ResolvedReportingSelection,
} from "@ryot-app/plugin-kit/schema";

import { property, propertyDate, propertyJson, propertyNumber } from "./entity-selections";
import type { fitnessMetricDefinitions } from "./fitness-metrics";
import { personalBestAwardCount, workoutSetMetric, workoutSetVolume } from "./fitness-metrics";
import {
	setMeasures,
	startedAt,
	workoutMeasures,
	workoutRangeSources,
} from "./workout-list-recipes";
import {
	muscleRoleSetWeight,
	occurrenceHasTaxonomy,
	occurrenceSets,
} from "./workout-taxonomy-recipes";

type Table = ReturnType<typeof table>;
type Input = {
	readonly reference: PluginIdentityReference;
	readonly reporting: ResolvedReportingSelection;
	readonly filter?: { readonly id: string; readonly kind: "targets" | "exercises" | "equipment" };
};
const fitnessSetFilter = (
	set: ReturnType<typeof table>,
	input: Input,
	occurrence?: ReturnType<typeof table>,
) => {
	const filter = input.filter;
	if (filter === undefined) {
		return and();
	}
	if (filter.kind === "exercises") {
		return eq(column(set, "entityId"), literal(filter.id));
	}
	const evidence = table("event", "filterOccurrence");
	const taxonomy = table("entity", "filterTaxonomy");
	if (occurrence !== undefined) {
		return exists(taxonomy, {
			where: and(
				eq(column(taxonomy, "id"), literal(filter.id)),
				occurrenceHasTaxonomy(occurrence, taxonomy, filter.kind),
			),
		});
	}
	return exists(evidence, {
		joins: [join("inner", taxonomy, eq(column(taxonomy, "id"), literal(filter.id)))],
		where: and(
			occurrenceSets(set, evidence),
			eq(column(evidence, "eventSchemaSlug"), literal("workout-exercise")),
			occurrenceHasTaxonomy(evidence, taxonomy, filter.kind),
		),
	});
};

const analyticsSources = (input: Input, range: null | ReportingPeriod, alias: string) => {
	const source = workoutRangeSources(input.reference, range, alias);
	return {
		...source,
		setWhere: and(source.setWhere, fitnessSetFilter(source.set, input, source.occurrence)),
		workoutWhere:
			input.filter === undefined
				? source.workoutWhere
				: and(
						source.workoutWhere,
						exists(source.set, {
							where: and(
								source.setWhere,
								fitnessSetFilter(source.set, input),
								eq(column(source.set, "sessionEntityId"), column(source.workout, "id")),
							),
						}),
					),
	};
};

export const fitnessAnalyticsTotalsRecipe = defineRecipe((input: Input) => {
	const range = input.reporting.current;
	const source = analyticsSources(input, range, "analytics");
	const entry = table("entity", "analyticsEntry");
	const reading = table("event", "analyticsReading");
	const metric = table("entity", "analyticsMetric");
	return {
		map: ({ sets, entries, workouts, readings }) =>
			Result.succeed({
				...workouts,
				...sets,
				measurementEntries: entries.entries,
				measurementReadings: readings.readings,
				personalBests: sets.personalBests ?? 0,
				processing: projectionProcessingState(sets),
				personalBestSets: sets.personalBestSets ?? 0,
				missingDurationWorkouts: workouts.workouts - (workouts.timedWorkouts ?? 0),
				missingCalorieWorkouts: workouts.workouts - (workouts.calorieWorkouts ?? 0),
			}),
		queries: {
			entries: selectedAggregate(entry, {
				measures: { entries: countAll },
				where: and(
					entitySchemaPredicate(entry, "measurement-entry", input.reference),
					withinPeriod(propertyDate(entry, "occurredAt"), range),
				),
			}),
			readings: selectedAggregate(reading, {
				measures: { readings: countAll },
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				where: and(
					schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					entitySchemaPredicate(metric, "measurement-metric", input.reference),
					withinPeriod(column(reading, "occurredAt"), range),
				),
			}),
			workouts: selectedAggregate(source.workout, {
				where: source.workoutWhere,
				measures: {
					...workoutMeasures(source.workout),
					calories: sumOf(propertyNumber(source.workout, "caloriesBurnt")),
					calorieWorkouts: countIf(isNotNull(propertyNumber(source.workout, "caloriesBurnt"))),
					activeDays: selectedMeasure(
						{
							function: "countDistinct",
							expr: dateBucket(startedAt(source.workout), {
								bucket: "day",
								timeZone: input.reporting.timeZone,
							}),
						},
						Schema.Finite,
					),
				},
			}),
			sets: selectedAggregate(source.set, {
				where: source.setWhere,
				joins: source.setJoins,
				measures: {
					...setMeasures(source.set),
					...projectionStatusMeasures(source.set),
					sets: countAll,
					repetitions: sumOf(workoutSetMetric(source.set, "reps")),
					distance: sumOf(workoutSetMetric(source.set, "distance")),
					plannedRest: sumOf(propertyNumber(source.set, "restTime")),
					setDuration: sumOf(workoutSetMetric(source.set, "duration")),
					personalBestSets: countIf(gt(personalBestAwardCount(source.set), literal(0))),
				},
			}),
		},
	};
});

const rankingTaxonomy = (occurrence: Table, kind: "targets" | "equipment" | "exercises") => {
	const target = table("entity", "rankTaxonomy");
	if (kind === "exercises") {
		return {
			target,
			weight: literal(1),
			joins: [join("inner", target, eq(column(target, "id"), column(occurrence, "entityId")))],
		};
	}
	const element = jsonElementsJoin("inner", "rankElement", propertyJson(occurrence, kind));
	const value = column(element, "value");
	return {
		target,
		weight:
			kind === "targets" ? muscleRoleSetWeight(castText(jsonPath(value, "role"))) : literal(1),
		joins: [
			element,
			join(
				"inner",
				target,
				eq(
					column(target, "id"),
					kind === "targets" ? castText(jsonPath(value, "entityId")) : castText(value),
				),
			),
		],
	};
};

export const historicalFitnessRankingRecipe = defineRecipe(
	(
		input: Input & {
			readonly after?: string | undefined;
			readonly kind: "targets" | "equipment" | "exercises";
		},
	) => {
		const range = input.reporting.current;
		const occurrence = table("event", "rankOccurrence");
		const set = table("event", "rankSet");
		const taxonomy = rankingTaxonomy(occurrence, input.kind);
		return {
			map: ({ ranking }) => Result.succeed(ranking),
			queries: {
				ranking: selectedAggregate(occurrence, {
					limit: 100,
					after: input.after,
					orderBy: [measureDescending("weightedSets"), groupAscending("id")],
					joins: [join("inner", set, occurrenceSets(set, occurrence)), ...taxonomy.joins],
					groupBy: {
						id: selectedField(column(taxonomy.target, "id"), Schema.String),
						name: selectedField(column(taxonomy.target, "name"), Schema.String),
					},
					measures: {
						sets: countAll,
						weightedSets: sumOf(taxonomy.weight),
						exerciseOccurrences: selectedMeasure(
							{ function: "countDistinct", expr: column(occurrence, "id") },
							Schema.Finite,
						),
						workouts: selectedMeasure(
							{ function: "countDistinct", expr: column(occurrence, "sessionEntityId") },
							Schema.Finite,
						),
					},
					where: and(
						schemaOwnerPredicate(occurrence, "eventSchemaPluginId", input.reference),
						eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
						entitySchemaPredicate(
							taxonomy.target,
							{
								exercises: "exercise",
								targets: "exercise-target",
								equipment: "exercise-equipment",
							}[input.kind],
							input.reference,
						),
						withinPeriod(column(occurrence, "occurredAt"), range),
						fitnessSetFilter(set, input, occurrence),
					),
				}),
			},
		};
	},
);

export const fitnessAnalyticsTrendRecipe = defineRecipe(
	(
		input: Input & {
			readonly metric: Exclude<
				keyof typeof fitnessMetricDefinitions,
				"personalBestSets" | "measurementEntries" | "measurementReadings"
			>;
		},
	) => {
		const resolved = input.reporting;
		const source = analyticsSources(input, resolved.current, "trend");
		const metric = input.metric;
		const workoutMetric =
			metric === "workouts" || metric === "activeDuration" || metric === "calories";
		const derivedMetric = metric === "volume" || metric === "personalBests";
		const values = {
			sets: literal(1),
			workouts: literal(1),
			volume: workoutSetVolume(source.set),
			personalBests: personalBestAwardCount(source.set),
			repetitions: workoutSetMetric(source.set, "reps"),
			distance: workoutSetMetric(source.set, "distance"),
			plannedRest: propertyNumber(source.set, "restTime"),
			setDuration: workoutSetMetric(source.set, "duration"),
			calories: propertyNumber(source.workout, "caloriesBurnt"),
			activeDuration: propertyNumber(source.workout, "activeDuration"),
		};
		const measures = {
			observations: countAll,
			value: sumOf(values[metric]),
			knownValues: countIf(isNotNull(values[metric])),
		};
		const groupBy = (at: Parameters<typeof dateBucket>[0]) => ({
			at: selectedField(
				dateBucket(at, { bucket: resolved.grouping, timeZone: input.reporting.timeZone }),
				Schema.String,
			),
		});
		return {
			map: ({ setTrend, workoutTrend, derivedTrend }) => {
				const points =
					derivedTrend?.items.map(({ at, value, knownValues, observations, ...status }) => ({
						at,
						value,
						knownValues,
						observations,
						processing: projectionProcessingState(status),
					})) ??
					(workoutTrend ?? setTrend)?.items.map(({ at, value, knownValues, observations }) => ({
						at,
						value,
						knownValues,
						observations,
						processing: "ready" as const,
					})) ??
					[];
				return Result.succeed({
					metric,
					points,
					period: resolved.current,
					grouping: resolved.grouping,
					processing: projectionProcessingState({
						failed: points.filter((point) => point.processing === "failed").length,
						pending: points.filter((point) => point.processing === "pending").length,
					}),
				});
			},
			queries: {
				workoutTrend: workoutMetric
					? selectedAggregate(source.workout, {
							measures,
							where: source.workoutWhere,
							limit: REPORTING_BUCKET_LIMIT,
							orderBy: [groupAscending("at")],
							groupBy: groupBy(startedAt(source.workout)),
						})
					: undefined,
				setTrend:
					workoutMetric || derivedMetric
						? undefined
						: selectedAggregate(source.set, {
								measures,
								joins: source.setJoins,
								where: source.setWhere,
								limit: REPORTING_BUCKET_LIMIT,
								orderBy: [groupAscending("at")],
								groupBy: groupBy(source.setStartedAt),
							}),
				derivedTrend: derivedMetric
					? selectedAggregate(source.set, {
							joins: source.setJoins,
							where: source.setWhere,
							limit: REPORTING_BUCKET_LIMIT,
							orderBy: [groupAscending("at")],
							groupBy: groupBy(source.setStartedAt),
							measures: { ...measures, ...projectionStatusMeasures(source.set) },
						})
					: undefined,
			},
		};
	},
);

export const fitnessWorkoutStartsByHourRecipe = defineRecipe((input: Input) => {
	const range = input.reporting.current;
	const source = analyticsSources(input, range, "hours");
	return {
		map: ({ hours }) =>
			Result.succeed({
				label: "Workout starts",
				hours: Array.from({ length: 24 }, (_, hour) => ({
					hour,
					starts: hours.items.find((item) => item.hour === hour)?.starts ?? 0,
				})),
			}),
		queries: {
			hours: selectedAggregate(source.workout, {
				limit: 24,
				where: source.workoutWhere,
				measures: { starts: countAll },
				orderBy: [groupAscending("hour")],
				groupBy: {
					hour: selectedField(
						localHour(startedAt(source.workout), { timeZone: input.reporting.timeZone }),
						Schema.Int,
					),
				},
			}),
		},
	};
});

export const fitnessAnalyticsWorkoutsRecipe = defineRecipe(
	(input: Input & { readonly after?: string | undefined }) => {
		const range = input.reporting.current;
		const source = analyticsSources(input, range, "drilldown");
		return {
			map: ({ workouts }) => Result.succeed(workouts),
			queries: {
				workouts: selectedRows(source.workout, {
					limit: 100,
					after: input.after,
					where: source.workoutWhere,
					orderBy: [descending(startedAt(source.workout)), ascending(column(source.workout, "id"))],
					selection: {
						id: selectedField(column(source.workout, "id"), Schema.String),
						name: selectedField(column(source.workout, "name"), Schema.String),
						startedAt: selectedField(startedAt(source.workout), Schema.String),
						activeDuration: selectedField(
							propertyNumber(source.workout, "activeDuration"),
							NullableNumber,
						),
					},
				}),
			},
		};
	},
);

export const fitnessMeasurementTrendRecipe = defineRecipe(
	(input: Omit<Input, "filter"> & { readonly metricId: string }) => {
		const resolved = input.reporting;
		const range = resolved.current;
		const reading = table("event", "measurementTrendReading");
		const metric = table("entity", "measurementTrendMetric");
		return {
			map: ({ trend }) =>
				Result.succeed({
					period: range,
					points: trend.items,
					metricId: input.metricId,
					grouping: resolved.grouping,
				}),
			queries: {
				trend: selectedAggregate(reading, {
					limit: REPORTING_BUCKET_LIMIT,
					orderBy: [groupAscending("at"), groupAscending("unit")],
					joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
					measures: {
						readings: countAll,
						value: selectedMeasure(
							{ function: "average", expr: propertyNumber(reading, "value") },
							Schema.Finite,
						),
					},
					groupBy: {
						unit: selectedField(property(metric, "unit"), Schema.NullOr(Schema.String)),
						at: selectedField(
							dateBucket(column(reading, "occurredAt"), {
								bucket: resolved.grouping,
								timeZone: input.reporting.timeZone,
							}),
							Schema.String,
						),
					},
					where: and(
						schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
						eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
						entitySchemaPredicate(metric, "measurement-metric", input.reference),
						eq(column(metric, "id"), literal(input.metricId)),
						withinPeriod(column(reading, "occurredAt"), range),
					),
				}),
			},
		};
	},
);

export const fitnessMeasurementReadingsRecipe = defineRecipe(
	(
		input: Omit<Input, "filter"> & {
			readonly metricId: string;
			readonly after?: string | undefined;
		},
	) => {
		const range = input.reporting.current;
		const reading = table("event", "measurementDrilldownReading");
		const metric = table("entity", "measurementDrilldownMetric");
		const entry = table("entity", "measurementDrilldownEntry");
		return {
			map: ({ readings }) => Result.succeed(readings),
			queries: {
				readings: selectedRows(reading, {
					limit: 100,
					after: input.after,
					orderBy: [descending(column(reading, "occurredAt")), ascending(column(reading, "id"))],
					joins: [
						join("inner", metric, eq(column(reading, "entityId"), column(metric, "id"))),
						join(
							"left",
							entry,
							and(
								eq(column(reading, "sessionEntityId"), column(entry, "id")),
								entitySchemaPredicate(entry, "measurement-entry", input.reference),
							),
						),
					],
					where: and(
						schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
						eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
						entitySchemaPredicate(metric, "measurement-metric", input.reference),
						eq(column(metric, "id"), literal(input.metricId)),
						withinPeriod(column(reading, "occurredAt"), range),
					),
					selection: {
						id: selectedField(column(reading, "id"), Schema.String),
						value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
						occurredAt: selectedField(column(reading, "occurredAt"), Schema.String),
						unit: selectedField(property(metric, "unit"), Schema.NullOr(Schema.String)),
						comment: selectedField(property(entry, "comment"), Schema.NullOr(Schema.String)),
						entryId: selectedField(
							column(reading, "sessionEntityId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

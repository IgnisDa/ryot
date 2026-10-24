import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	conditional,
	count,
	countDistinct,
	dateBucket,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	exists,
	groupAscending,
	gt,
	gte,
	isNotNull,
	join,
	literal,
	localHour,
	lt,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	type PluginIdentityReference,
	type ReportingPeriod,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-kit/schema";

import { property, propertyDate, propertyNumber } from "./entity-selections";
import {
	fitnessMetricDefinitions,
	personalBestAwardCount,
	projectionCoverageMeasures,
	projectionsReady,
	workoutSetMetric,
	workoutSetVolume,
} from "./fitness-metrics";
import {
	setMeasures,
	startedAt,
	workoutMeasures,
	workoutRangeSources,
} from "./workout-list-recipes";
import {
	occurrenceHasTaxonomy,
	occurrenceSets,
	recordedMuscleSetWeight,
} from "./workout-taxonomy-recipes";

type Input = {
	readonly now: number;
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
	readonly reference: PluginIdentityReference;
	readonly filter?: { readonly id: string; readonly kind: "targets" | "exercises" | "equipment" };
};
const nullableNumber = Schema.NullOr(Schema.Finite);
const sumMeasure = (expr: Parameters<typeof selectedField>[0]) =>
	selectedMeasure({ expr, function: "sum" }, nullableNumber);
const countMeasure = selectedMeasure({ function: "count" }, Schema.Finite);
const within = (at: Parameters<typeof selectedField>[0], range: null | ReportingPeriod) =>
	and(
		...(range === null
			? []
			: [gte(at, castDate(literal(range.startAt))), lt(at, castDate(literal(range.endAt)))]),
	);

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
	const source = workoutRangeSources(input.reference, range ?? {}, alias);
	const setWhere = and(source.setWhere, fitnessSetFilter(source.set, input));
	return {
		...source,
		setWhere,
		workoutWhere:
			input.filter === undefined
				? source.workoutWhere
				: and(
						source.workoutWhere,
						exists(source.set, {
							where: and(
								setWhere,
								eq(column(source.set, "sessionEntityId"), column(source.workout, "id")),
							),
						}),
					),
	};
};

export const fitnessAnalyticsTotalsRecipe = defineRecipe((input: Input) => {
	const range = resolveReportingSelection(input.selection, input).current;
	const source = workoutRangeSources(input.reference, range ?? {}, "analytics");
	const occurrence = table("event", "analyticsOccurrence");
	const retainedTaxonomy = and(
		eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
		occurrenceSets(source.set, occurrence),
	);
	const setScope = {
		joins: [...source.setJoins, join("left", occurrence, retainedTaxonomy)],
		where: and(source.setWhere, fitnessSetFilter(source.set, input, occurrence)),
	};
	const entry = table("entity", "analyticsEntry");
	const reading = table("event", "analyticsReading");
	const metric = table("entity", "analyticsMetric");
	return {
		map: ({ sets, entries, workouts, readings, evidenceIntegrity }) => {
			if (
				evidenceIntegrity.matchedRows !== evidenceIntegrity.distinctSets ||
				evidenceIntegrity.matchedRows !== sets.sets
			) {
				return Result.fail(new Error("Workout occurrence evidence is ambiguous"));
			}
			const pendingSets = sets.pendingSets ?? 0;
			const failedSets = sets.failedSets ?? 0;
			const ready = projectionsReady(sets);
			return Result.succeed({
				...workouts,
				...sets,
				failedSets,
				pendingSets,
				volume: ready ? sets.volume : null,
				measurementEntries: entries.entries,
				measurementReadings: readings.readings,
				personalBests: ready ? (sets.personalBests ?? 0) : null,
				missingTaxonomySets: sets.sets - (sets.taxonomySets ?? 0),
				personalBestSets: ready ? (sets.personalBestSets ?? 0) : null,
				missingDurationWorkouts: workouts.workouts - (workouts.timedWorkouts ?? 0),
				missingCalorieWorkouts: workouts.workouts - (workouts.calorieWorkouts ?? 0),
			});
		},
		queries: {
			entries: selectedAggregate(entry, {
				measures: { entries: countMeasure },
				where: and(
					entitySchemaPredicate(entry, "measurement-entry", input.reference),
					within(propertyDate(entry, "occurredAt"), range),
				),
			}),
			evidenceIntegrity: selectedAggregate(source.set, {
				...setScope,
				measures: {
					matchedRows: countMeasure,
					distinctSets: selectedMeasure(
						{ function: "countDistinct", expr: column(source.set, "id") },
						Schema.Finite,
					),
				},
			}),
			readings: selectedAggregate(reading, {
				measures: { readings: countMeasure },
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				where: and(
					schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					entitySchemaPredicate(metric, "measurement-metric", input.reference),
					within(column(reading, "occurredAt"), range),
				),
			}),
			workouts: selectedAggregate(source.workout, {
				where: analyticsSources(input, range, "analytics").workoutWhere,
				measures: {
					...workoutMeasures(source.workout),
					calories: sumMeasure(propertyNumber(source.workout, "caloriesBurnt")),
					calorieWorkouts: sumMeasure(
						conditional(
							isNotNull(propertyNumber(source.workout, "caloriesBurnt")),
							literal(1),
							literal(0),
						),
					),
					activeDays: selectedMeasure(
						{
							function: "countDistinct",
							expr: dateBucket(startedAt(source.workout), {
								bucket: "day",
								timeZone: input.timeZone,
							}),
						},
						Schema.Finite,
					),
				},
			}),
			sets: selectedAggregate(source.set, {
				...setScope,
				measures: {
					...setMeasures(source.set),
					sets: countMeasure,
					repetitions: sumMeasure(workoutSetMetric(source.set, "reps")),
					distance: sumMeasure(workoutSetMetric(source.set, "distance")),
					plannedRest: sumMeasure(propertyNumber(source.set, "restTime")),
					setDuration: sumMeasure(workoutSetMetric(source.set, "duration")),
					taxonomySets: sumMeasure(
						conditional(isNotNull(column(occurrence, "id")), literal(1), literal(0)),
					),
					personalBestSets: sumMeasure(
						conditional(gt(personalBestAwardCount(source.set), literal(0)), literal(1), literal(0)),
					),
					legacyTaxonomySets: sumMeasure(
						conditional(
							eq(property(occurrence, "provenance"), literal("legacy")),
							literal(1),
							literal(0),
						),
					),
				},
			}),
		},
	};
});

export const historicalFitnessRankingRecipe = defineRecipe(
	(
		input: Input & {
			readonly after?: string | undefined;
			readonly kind: "targets" | "equipment" | "exercises";
		},
	) => {
		const range = resolveReportingSelection(input.selection, input).current;
		const target = table("entity", "rankTaxonomy");
		const occurrence = table("event", "rankOccurrence");
		const set = table("event", "rankSet");
		const workout = table("entity", "rankWorkout");
		const joins = [
			join(
				"inner",
				workout,
				and(
					eq(column(occurrence, "sessionEntityId"), column(workout, "id")),
					entitySchemaPredicate(workout, "workout", input.reference),
				),
			),
			join("inner", set, occurrenceSets(set, occurrence)),
		];
		const where = and(
			schemaOwnerPredicate(occurrence, "eventSchemaPluginId", input.reference),
			eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
			input.kind === "exercises"
				? eq(column(occurrence, "entityId"), column(target, "id"))
				: occurrenceHasTaxonomy(occurrence, target, input.kind),
			within(startedAt(workout), range),
			fitnessSetFilter(set, input, occurrence),
		);
		const weightedSets = sum(
			occurrence,
			input.kind === "targets" ? recordedMuscleSetWeight(occurrence, target) : literal(1),
			{ joins, where },
		);
		return {
			map: ({ ranking }) =>
				Result.map(
					Result.all(
						ranking.items.map(({ evidenceSets, ...row }) =>
							evidenceSets === row.sets
								? Result.succeed(row)
								: Result.fail(new Error("Workout occurrence evidence is ambiguous")),
						),
					),
					(items) => ({ ...ranking, items }),
				),
			queries: {
				ranking: selectedRows(target, {
					limit: 100,
					after: input.after,
					orderBy: [descending(weightedSets), ascending(column(target, "id"))],
					where: entitySchemaPredicate(
						target,
						{ exercises: "exercise", targets: "exercise-target", equipment: "exercise-equipment" }[
							input.kind
						],
						input.reference,
					),
					selection: {
						id: selectedField(column(target, "id"), Schema.String),
						weightedSets: selectedField(weightedSets, nullableNumber),
						name: selectedField(column(target, "name"), Schema.String),
						sets: selectedField(count(occurrence, { joins, where }), Schema.Finite),
						evidenceSets: selectedField(
							countDistinct(occurrence, column(set, "id"), { joins, where }),
							Schema.Finite,
						),
						workouts: selectedField(
							countDistinct(occurrence, column(workout, "id"), { joins, where }),
							Schema.Finite,
						),
						exerciseOccurrences: selectedField(
							countDistinct(occurrence, column(occurrence, "id"), { joins, where }),
							Schema.Finite,
						),
					},
				}),
			},
		};
	},
);

export const fitnessAnalyticsTrendRecipe = defineRecipe(
	(
		input: Input & {
			readonly period?: "current" | "previous";
			readonly metric: Exclude<
				keyof typeof fitnessMetricDefinitions,
				"personalBestSets" | "measurementEntries" | "measurementReadings"
			>;
		},
	) => {
		const resolved = resolveReportingSelection(input.selection, input);
		const range = input.period === "previous" ? resolved.previous : resolved.current;
		const source = analyticsSources(input, range, "trend");
		const workoutMetric =
			input.metric === "workouts" ||
			input.metric === "activeDuration" ||
			input.metric === "calories";
		const metric = input.metric;
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
		const unit = fitnessMetricDefinitions[metric].unit;
		return {
			map: ({ trend }) =>
				Result.succeed({
					unit,
					metric,
					period: range,
					grouping: resolved.grouping,
					hasMore: trend.pageInfo?.hasMore ?? false,
					points: trend.items.map((point) => ({
						...point,
						value:
							(metric === "volume" || metric === "personalBests") && !projectionsReady(point)
								? null
								: point.value,
					})),
				}),
			queries: {
				trend: selectedAggregate(workoutMetric ? source.workout : source.set, {
					limit: 1000,
					orderBy: [groupAscending("at")],
					joins: workoutMetric ? [] : source.setJoins,
					where: and(
						workoutMetric ? source.workoutWhere : source.setWhere,
						...(input.period === "previous" && range === null ? [eq(literal(1), literal(0))] : []),
					),
					groupBy: {
						at: selectedField(
							dateBucket(startedAt(source.workout), {
								timeZone: input.timeZone,
								bucket: resolved.grouping,
							}),
							Schema.String,
						),
					},
					measures: {
						observations: countMeasure,
						value: sumMeasure(values[metric]),
						knownValues: sumMeasure(conditional(isNotNull(values[metric]), literal(1), literal(0))),
						...(workoutMetric
							? { failedSets: sumMeasure(literal(0)), pendingSets: sumMeasure(literal(0)) }
							: projectionCoverageMeasures(source.set)),
					},
				}),
			},
		};
	},
);

export const fitnessWorkoutStartsByHourRecipe = defineRecipe((input: Input) => {
	const range = resolveReportingSelection(input.selection, input).current;
	const source = analyticsSources(input, range, "hours");
	return {
		map: ({ hours }) =>
			Result.succeed({
				label: "Workout starts",
				hasMore: hours.pageInfo?.hasMore ?? false,
				hours: Array.from({ length: 24 }, (_, hour) => ({
					hour,
					starts: hours.items.find((item) => item.hour === hour)?.starts ?? 0,
				})),
			}),
		queries: {
			hours: selectedAggregate(source.workout, {
				limit: 24,
				where: source.workoutWhere,
				orderBy: [groupAscending("hour")],
				measures: { starts: countMeasure },
				groupBy: {
					hour: selectedField(
						localHour(startedAt(source.workout), { timeZone: input.timeZone }),
						Schema.Int,
					),
				},
			}),
		},
	};
});

export const fitnessAnalyticsWorkoutsRecipe = defineRecipe(
	(input: Input & { readonly after?: string }) => {
		const range = resolveReportingSelection(input.selection, input).current;
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
							nullableNumber,
						),
					},
				}),
			},
		};
	},
);

export const fitnessMeasurementTrendRecipe = defineRecipe(
	(
		input: Omit<Input, "filter"> & {
			readonly metricId: string;
			readonly period?: "current" | "previous";
		},
	) => {
		const resolved = resolveReportingSelection(input.selection, input);
		const range = input.period === "previous" ? resolved.previous : resolved.current;
		const reading = table("event", "measurementTrendReading");
		const metric = table("entity", "measurementTrendMetric");
		return {
			map: ({ trend }) =>
				Result.succeed({
					period: range,
					points: trend.items,
					metricId: input.metricId,
					grouping: resolved.grouping,
					hasMore: trend.pageInfo?.hasMore ?? false,
				}),
			queries: {
				trend: selectedAggregate(reading, {
					limit: 1000,
					orderBy: [groupAscending("at"), groupAscending("unit")],
					joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
					measures: {
						readings: countMeasure,
						value: selectedMeasure(
							{ function: "average", expr: propertyNumber(reading, "value") },
							Schema.Finite,
						),
					},
					groupBy: {
						unit: selectedField(property(metric, "unit"), Schema.NullOr(Schema.String)),
						at: selectedField(
							dateBucket(column(reading, "occurredAt"), {
								timeZone: input.timeZone,
								bucket: resolved.grouping,
							}),
							Schema.String,
						),
					},
					where: and(
						schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
						eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
						entitySchemaPredicate(metric, "measurement-metric", input.reference),
						eq(column(metric, "id"), literal(input.metricId)),
						within(column(reading, "occurredAt"), range),
						...(input.period === "previous" && range === null ? [eq(literal(1), literal(0))] : []),
					),
				}),
			},
		};
	},
);

export const fitnessMeasurementReadingsRecipe = defineRecipe(
	(input: Omit<Input, "filter"> & { readonly after?: string; readonly metricId: string }) => {
		const range = resolveReportingSelection(input.selection, input).current;
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
						within(column(reading, "occurredAt"), range),
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

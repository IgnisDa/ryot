import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import type { Predicate, ScalarExpression } from "@ryot-app/plugin-kit/ryotql";
import {
	and,
	ascending,
	castText,
	column,
	conditional,
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
	inArray,
	isNotNull,
	join,
	jsonElementsJoin,
	jsonPath,
	literal,
	localHour,
	measureDescending,
	NullableNumber,
	parameters,
	projectionProcessingState,
	projectionStatusMeasures,
	reportingGroupingExpression,
	reportingParameterFields,
	reportingParameters,
	reportingPeriodPredicate,
	reportingTimeZone,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	sumOf,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { type PluginIdentityReference, REPORTING_BUCKET_LIMIT } from "@ryot-app/plugin-kit/schema";

import { property, propertyDate, propertyJson, propertyNumber } from "./entity-selections";
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

export type FitnessAnalyticsFilter = {
	readonly id: string;
	readonly kind: "targets" | "exercises" | "equipment";
};
type Table = Parameters<typeof column>[0];
export const fitnessFilterParameterFields = {
	filterId: {
		type: "string",
		label: "Filter entity",
		description: "Restrict sets and workouts to one recorded exercise, muscle, or equipment item",
	},
	filterKind: {
		type: "enum",
		label: "Filter kind",
		defaultValue: "exercises",
		description: "Kind of recorded entity selected by the filter",
		choices: {
			kind: "static",
			values: [{ value: "targets" }, { value: "exercises" }, { value: "equipment" }],
		},
	},
} as const;
const filterParameters = parameters({ fields: fitnessFilterParameterFields });
type Input = { readonly reference: PluginIdentityReference };
const fitnessSetFilter = (set: Table, input: Input, occurrence?: Table) => {
	const taxonomy = table("entity", "filterTaxonomy");
	const evidence = table("event", "filterOccurrence");
	const selected = (kind: "targets" | "equipment") =>
		occurrence === undefined
			? exists(evidence, {
					joins: [
						join("inner", taxonomy, eq(column(taxonomy, "id"), filterParameters.value("filterId"))),
					],
					where: and(
						occurrenceSets(set, evidence),
						eq(column(evidence, "eventSchemaSlug"), literal("workout-exercise")),
						occurrenceHasTaxonomy(evidence, taxonomy, kind),
					),
				})
			: exists(taxonomy, {
					where: and(
						eq(column(taxonomy, "id"), filterParameters.value("filterId")),
						occurrenceHasTaxonomy(occurrence, taxonomy, kind),
					),
				});
	return filterParameters.whenSet(
		"filterId",
		filterParameters.choice("filterKind", {
			targets: selected("targets"),
			equipment: selected("equipment"),
			exercises: eq(column(set, "entityId"), filterParameters.value("filterId")),
		}),
	);
};
const analyticsSources = (
	input: Input,
	range: (at: ScalarExpression) => Predicate,
	alias: string,
) => {
	const source = workoutRangeSources(input.reference, range, alias);
	return {
		...source,
		setWhere: and(source.setWhere, fitnessSetFilter(source.set, input, source.occurrence)),
		workoutWhere: and(
			source.workoutWhere,
			filterParameters.whenSet(
				"filterId",
				exists(source.set, {
					where: and(
						source.setWhere,
						fitnessSetFilter(source.set, input),
						eq(column(source.set, "sessionEntityId"), column(source.workout, "id")),
					),
				}),
			),
		),
	};
};
export const fitnessAnalyticsTotalsRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: { ...reportingParameterFields, ...fitnessFilterParameterFields },
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingPeriodPredicate,
			grouping: reportingParameters.value("grouping"),
		},
	};
	const range = input.reporting.current;
	const source = analyticsSources(input, range, "analytics");
	const entry = table("entity", "analyticsEntry");
	const reading = table("event", "analyticsReading");
	const metric = table("entity", "analyticsMetric");
	return defineRecipe({
		parameters: args.schema,
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
					range(propertyDate(entry, "occurredAt")),
				),
			}),
			readings: selectedAggregate(reading, {
				measures: { readings: countAll },
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				where: and(
					schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					entitySchemaPredicate(metric, "measurement-metric", input.reference),
					range(column(reading, "occurredAt")),
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
	});
};
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
const rankingParameters = parameters({
	fields: {
		...reportingParameterFields,
		...fitnessFilterParameterFields,
		kind: {
			type: "enum",
			label: "Ranking",
			defaultValue: "targets",
			description: "Rank recorded muscles, equipment, or exercises by weighted sets",
			choices: {
				kind: "static",
				values: [{ value: "targets" }, { value: "equipment" }, { value: "exercises" }],
			},
		},
	},
});
export const historicalFitnessRankingRecipe = (input: Input) => {
	const ranking = (kind: "targets" | "equipment" | "exercises") => {
		const set = table("event", "rankSet"),
			occurrence = table("event", "rankOccurrence");
		const taxonomy = rankingTaxonomy(occurrence, kind);
		return selectedAggregate(occurrence, {
			limit: 100,
			maxLimit: 100,
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
				eq(rankingParameters.value("kind"), literal(kind)),
				schemaOwnerPredicate(occurrence, "eventSchemaPluginId", input.reference),
				eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
				entitySchemaPredicate(
					taxonomy.target,
					{ exercises: "exercise", targets: "exercise-target", equipment: "exercise-equipment" }[
						kind
					],
					input.reference,
				),
				reportingPeriodPredicate(column(occurrence, "occurredAt")),
				fitnessSetFilter(set, input, occurrence),
			),
		});
	};
	return defineRecipe({
		parameters: rankingParameters.schema,
		queries: {
			targets: ranking("targets"),
			equipment: ranking("equipment"),
			exercises: ranking("exercises"),
		},
		map: ({ targets, equipment, exercises }) => {
			const pages = [targets, equipment, exercises];
			const page =
				pages.find((candidate) => candidate.items.length > 0 || candidate.pageInfo.hasMore) ??
				pages.reduce((left, right) => (left.pageInfo.limit <= right.pageInfo.limit ? left : right));
			return Result.succeed({ ...page, items: pages.flatMap((candidate) => candidate.items) });
		},
	});
};
export const fitnessTrendMetrics = [
	"sets",
	"workouts",
	"volume",
	"personalBests",
	"repetitions",
	"distance",
	"plannedRest",
	"setDuration",
	"calories",
	"activeDuration",
] as const;
export type FitnessAnalyticsMetric = (typeof fitnessTrendMetrics)[number];
const trendParameters = parameters({
	fields: {
		...reportingParameterFields,
		...fitnessFilterParameterFields,
		metric: {
			type: "enum",
			label: "Metric",
			defaultValue: "workouts",
			description: "Workout or set measurement to group over the selected period",
			choices: { kind: "static", values: fitnessTrendMetrics.map((value) => ({ value })) },
		},
	},
});
const trendMeasures = (value: ScalarExpression) => ({
	value: sumOf(value),
	observations: countAll,
	knownValues: countIf(isNotNull(value)),
});
const trendGroupBy = (at: ScalarExpression) => ({
	at: selectedField(
		reportingGroupingExpression((bucket) =>
			dateBucket(at, { bucket, timeZone: reportingTimeZone }),
		),
		Schema.String,
	),
});
export const fitnessAnalyticsTrendRecipe = (input: Input) => {
	const source = analyticsSources(input, reportingPeriodPredicate, "trend");
	const metricIs = (metric: FitnessAnalyticsMetric) =>
		eq(trendParameters.value("metric"), literal(metric));
	const workoutValue = conditional(
		metricIs("workouts"),
		literal(1),
		conditional(
			metricIs("calories"),
			propertyNumber(source.workout, "caloriesBurnt"),
			conditional(
				metricIs("activeDuration"),
				propertyNumber(source.workout, "activeDuration"),
				literal(null),
			),
		),
	);
	const setValue = conditional(
		metricIs("sets"),
		literal(1),
		conditional(
			metricIs("repetitions"),
			workoutSetMetric(source.set, "reps"),
			conditional(
				metricIs("distance"),
				workoutSetMetric(source.set, "distance"),
				conditional(
					metricIs("plannedRest"),
					propertyNumber(source.set, "restTime"),
					conditional(
						metricIs("setDuration"),
						workoutSetMetric(source.set, "duration"),
						literal(null),
					),
				),
			),
		),
	);
	const derivedValue = conditional(
		metricIs("volume"),
		workoutSetVolume(source.set),
		conditional(metricIs("personalBests"), personalBestAwardCount(source.set), literal(null)),
	);

	const enabled = (metrics: readonly FitnessAnalyticsMetric[]) =>
		inArray(trendParameters.value("metric"), metrics.map(literal));

	return defineRecipe({
		parameters: trendParameters.schema,
		map: ({ setTrend, workoutTrend, derivedTrend }) => {
			const points = [
				...derivedTrend.items.map(({ at, value, knownValues, observations, ...status }) => ({
					at,
					value,
					knownValues,
					observations,
					processing: projectionProcessingState(status),
				})),
				...[...workoutTrend.items, ...setTrend.items].map((row) => ({
					at: row.at,
					value: row.value,
					knownValues: row.knownValues,
					processing: "ready" as const,
					observations: row.observations,
				})),
			];
			return Result.succeed({
				points,
				processing: projectionProcessingState({
					failed: points.filter((point) => point.processing === "failed").length,
					pending: points.filter((point) => point.processing === "pending").length,
				}),
			});
		},
		queries: {
			workoutTrend: selectedAggregate(source.workout, {
				limit: REPORTING_BUCKET_LIMIT,
				orderBy: [groupAscending("at")],
				measures: trendMeasures(workoutValue),
				groupBy: trendGroupBy(startedAt(source.workout)),
				where: and(source.workoutWhere, enabled(["workouts", "activeDuration", "calories"])),
			}),
			setTrend: selectedAggregate(source.set, {
				joins: source.setJoins,
				limit: REPORTING_BUCKET_LIMIT,
				orderBy: [groupAscending("at")],
				measures: trendMeasures(setValue),
				groupBy: trendGroupBy(source.setStartedAt),
				where: and(
					source.setWhere,
					enabled(["sets", "repetitions", "distance", "plannedRest", "setDuration"]),
				),
			}),
			derivedTrend: selectedAggregate(source.set, {
				joins: source.setJoins,
				limit: REPORTING_BUCKET_LIMIT,
				orderBy: [groupAscending("at")],
				groupBy: trendGroupBy(source.setStartedAt),
				where: and(source.setWhere, enabled(["volume", "personalBests"])),
				measures: { ...trendMeasures(derivedValue), ...projectionStatusMeasures(source.set) },
			}),
		},
	});
};
export const fitnessWorkoutStartsByHourRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: { ...reportingParameterFields, ...fitnessFilterParameterFields },
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingPeriodPredicate,
			grouping: reportingParameters.value("grouping"),
		},
	};
	const range = input.reporting.current;
	const source = analyticsSources(input, range, "hours");
	return defineRecipe({
		parameters: args.schema,
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
	});
};
export const fitnessAnalyticsWorkoutsRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: { ...reportingParameterFields, ...fitnessFilterParameterFields },
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingPeriodPredicate,
			grouping: reportingParameters.value("grouping"),
		},
	};
	const range = input.reporting.current;
	const source = analyticsSources(input, range, "drilldown");
	return defineRecipe({
		parameters: args.schema,
		map: ({ workouts }) => Result.succeed(workouts),
		queries: {
			workouts: selectedRows(source.workout, {
				limit: 100,
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
	});
};
export const fitnessMeasurementTrendRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			metricId: {
				type: "string",
				label: "Metric",
				validation: { required: true },
				description: "Measurement metric to read",
			},
		},
	});
	const input = {
		reference: structural.reference,
		metricId: args.value("metricId"),
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingPeriodPredicate,
			grouping: reportingParameters.value("grouping"),
		},
	};
	const range = input.reporting.current;
	const reading = table("event", "measurementTrendReading");
	const metric = table("entity", "measurementTrendMetric");
	return defineRecipe({
		parameters: args.schema,
		map: ({ trend }) => Result.succeed({ points: trend.items }),
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
						reportingGroupingExpression((bucket) =>
							dateBucket(column(reading, "occurredAt"), {
								bucket,
								timeZone: input.reporting.timeZone,
							}),
						),
						Schema.String,
					),
				},
				where: and(
					schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					entitySchemaPredicate(metric, "measurement-metric", input.reference),
					eq(column(metric, "id"), input.metricId),
					range(column(reading, "occurredAt")),
				),
			}),
		},
	});
};
export const fitnessMeasurementReadingsRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			metricId: {
				type: "string",
				label: "Metric",
				validation: { required: true },
				description: "Measurement metric to read",
			},
		},
	});
	const input = {
		reference: structural.reference,
		metricId: args.value("metricId"),
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingPeriodPredicate,
			grouping: reportingParameters.value("grouping"),
		},
	};
	const range = input.reporting.current;
	const reading = table("event", "measurementDrilldownReading");
	const metric = table("entity", "measurementDrilldownMetric");
	const entry = table("entity", "measurementDrilldownEntry");
	return defineRecipe({
		parameters: args.schema,
		map: ({ readings }) => Result.succeed(readings),
		queries: {
			readings: selectedRows(reading, {
				limit: 100,
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
					eq(column(metric, "id"), input.metricId),
					range(column(reading, "occurredAt")),
				),
				selection: {
					id: selectedField(column(reading, "id"), Schema.String),
					value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
					occurredAt: selectedField(column(reading, "occurredAt"), Schema.String),
					unit: selectedField(property(metric, "unit"), Schema.NullOr(Schema.String)),
					comment: selectedField(property(entry, "comment"), Schema.NullOr(Schema.String)),
					entryId: selectedField(column(reading, "sessionEntityId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};

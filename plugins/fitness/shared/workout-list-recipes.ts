import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	conditional,
	contains,
	count,
	countAll,
	countDistinct,
	countIf,
	dateBucket,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	first,
	groupAscending,
	inArray,
	isNotNull,
	IsoDateString,
	join,
	jsonArrayExists,
	literal,
	lt,
	NullableNumber,
	ProjectionProcessing,
	projectionProcessing,
	projectionProcessingState,
	type Recipe,
	relationshipSchemaPredicate,
	rows,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedInclude,
	type SelectedMeasureRow,
	selectedRows,
	sum,
	sumOf,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import type {
	PluginIdentityReference,
	ReportingPeriod,
	TimeZone,
} from "@ryot-app/plugin-kit/schema";

import {
	projectionNumber,
	projectionProperty,
	property,
	propertyDate,
	propertyNumber,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { personalBestAwardCount, workoutSetProcessing, workoutSetVolume } from "./fitness-metrics";
import { workoutTemplateInclude } from "./query-recipes";
import { exerciseTargetInclude } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";
import { occurrenceSets } from "./workout-taxonomy-recipes";

export type WorkoutFilterPredicate = ReturnType<typeof and>;
type Table = ReturnType<typeof table>;
type Reference = PluginIdentityReference;
type Range = Pick<ReportingPeriod, "endAt" | "startAt">;

export const WORKOUT_LIST_PAGE_SIZE = 20;

const nullableString = Schema.NullOr(Schema.String);
const templateSlug = "workout-to-workout-template";

export const startedAt = (workout: Table) => propertyDate(workout, "startedAt");

const workoutSets = (set: Table, workout: Table) =>
	and(
		eq(column(set, "sessionEntityId"), column(workout, "id")),
		eq(column(set, "eventSchemaPluginId"), column(workout, "entitySchemaPluginId")),
		eq(column(set, "eventSchemaSlug"), literal("workout-set")),
	);

export const workoutTotals = (workout: Table, setAlias: string) => {
	const set = table("event", setAlias);
	const sets = workoutSets(set, workout);
	return {
		setCount: count(set, { where: sets }),
		processing: projectionProcessing(set, sets),
		personalBests: sum(set, personalBestAwardCount(set), { where: sets }),
		exerciseCount: countDistinct(set, propertyNumber(set, "exerciseOrder"), { where: sets }),
	};
};

const LIST_WORKOUT_ALIAS = "workout";
const WEEKS_ALIAS = "weeks";
const rangeWorkoutAlias = (alias: string) => `${alias}Workout`;

export const workoutFilterScope = (target: "list" | "weeks") => {
	const alias = target === "list" ? LIST_WORKOUT_ALIAS : rangeWorkoutAlias(WEEKS_ALIAS);
	const workout = table("entity", alias);
	const totals = workoutTotals(workout, "filterTotalsSet");
	return {
		subject: { entityAlias: alias },
		source: rows(workout, {
			fields: [
				{ key: "startedAt", expr: startedAt(workout) },
				{ key: "setCount", expr: totals.setCount },
				{ key: "exerciseCount", expr: totals.exerciseCount },
				{ key: "personalBests", expr: totals.personalBests },
			],
		}),
	};
};

const workoutWhere = (
	workout: Table,
	reference: Reference,
	search: string,
	filter?: WorkoutFilterPredicate,
) =>
	and(
		entitySchemaPredicate(workout, "workout", reference),
		...(search === "" ? [] : [contains(column(workout, "name"), literal(search))]),
		...(filter === undefined ? [] : [filter]),
	);

const workoutVolume = (workout: Table) => {
	const set = table("event", "volumeWorkoutSet");
	const sets = workoutSets(set, workout);
	return selectedField(
		conditional(
			eq(projectionProcessing(set, sets), literal("ready")),
			sum(set, workoutSetVolume(set), { where: sets }),
			literal(null),
		),
		NullableNumber,
	);
};

const repeatedFromId = (workout: Table, reference: Reference) => {
	const relationship = table("relationship", "listRepeatedFrom");
	return first(relationship, {
		select: column(relationship, "targetEntityId"),
		orderBy: [ascending(column(relationship, "id"))],
		where: and(
			eq(column(relationship, "sourceEntityId"), column(workout, "id")),
			relationshipSchemaPredicate(relationship, "workout-repeated-from", reference),
		),
	});
};

const previousTemplateWorkoutId = (workout: Table, reference: Reference) => {
	const link = table("relationship", "listTemplateLink");
	const priorLink = table("relationship", "listPriorTemplateLink");
	const prior = table("entity", "listPriorWorkout");
	return first(priorLink, {
		select: column(prior, "id"),
		orderBy: [descending(startedAt(prior)), descending(column(prior, "id"))],
		joins: [
			join("inner", link, eq(column(link, "targetEntityId"), column(priorLink, "targetEntityId"))),
			join("inner", prior, eq(column(priorLink, "sourceEntityId"), column(prior, "id"))),
		],
		where: and(
			eq(column(link, "sourceEntityId"), column(workout, "id")),
			relationshipSchemaPredicate(link, templateSlug, reference),
			relationshipSchemaPredicate(priorLink, templateSlug, reference),
			entitySchemaPredicate(prior, "workout", reference),
			lt(startedAt(prior), startedAt(workout)),
		),
	});
};

const workoutSetsInclude = (workout: Table) => {
	const set = table("event", "listWorkoutSet");
	const exercise = table("entity", "listWorkoutExercise");
	return selectedInclude(set, {
		limit: 100,
		joins: [join("inner", exercise, eq(column(set, "entityId"), column(exercise, "id")))],
		orderBy: [
			ascending(propertyNumber(set, "exerciseOrder")),
			ascending(propertyNumber(set, "setOrder")),
		],
		where: and(
			eq(column(set, "sessionEntityId"), column(workout, "id")),
			eq(column(set, "eventSchemaPluginId"), column(workout, "entitySchemaPluginId")),
			eq(column(exercise, "entitySchemaPluginId"), column(workout, "entitySchemaPluginId")),
			eq(column(set, "eventSchemaSlug"), literal("workout-set")),
			eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
		),
		selection: {
			id: selectedField(column(set, "id"), Schema.String),
			reps: selectedField(propertyNumber(set, "reps"), NullableNumber),
			exerciseId: selectedField(column(exercise, "id"), Schema.String),
			oneRm: selectedField(projectionNumber(set, "oneRm"), NullableNumber),
			weight: selectedField(propertyNumber(set, "weight"), NullableNumber),
			exerciseName: selectedField(column(exercise, "name"), Schema.String),
			setOrder: selectedField(propertyNumber(set, "setOrder"), NullableNumber),
			duration: selectedField(propertyNumber(set, "duration"), NullableNumber),
			distance: selectedField(propertyNumber(set, "distance"), NullableNumber),
			exerciseKind: selectedField(property(set, "exerciseKind"), exerciseKindSchema),
			exerciseOrder: selectedField(propertyNumber(set, "exerciseOrder"), NullableNumber),
			personalBests: selectedField(
				projectionProperty(set, "personalBests"),
				Schema.NullOr(Schema.Array(PersonalBestSchema)),
			),
		},
	});
};

export const workoutCardsRecipe = defineRecipe(
	(input: {
		readonly search: string;
		readonly reference: Reference;
		readonly limit?: number | undefined;
		readonly after?: string | undefined;
		readonly workoutIds?: undefined | readonly string[];
		readonly filter?: undefined | WorkoutFilterPredicate;
	}) => {
		const workout = table("entity", LIST_WORKOUT_ALIAS);
		const totals = workoutTotals(workout, "listTotalsSet");
		return {
			map: ({ workouts }) =>
				Result.succeed({
					...workouts,
					items: workouts.items.map(({ template, sets: included, ...item }) => ({
						...item,
						sets: included.items,
						template: template.items[0] ?? null,
						volume: item.processing === "ready" ? item.volume : null,
						personalBests: item.processing === "ready" ? item.personalBests : null,
					})),
				}),
			queries: {
				workouts: selectedRows(workout, {
					after: input.after,
					limit: input.limit ?? WORKOUT_LIST_PAGE_SIZE,
					orderBy: [descending(startedAt(workout)), descending(column(workout, "id"))],
					include: {
						sets: workoutSetsInclude(workout),
						template: workoutTemplateInclude(workout, 1),
					},
					where: and(
						workoutWhere(workout, input.reference, input.search, input.filter),
						...(input.workoutIds === undefined
							? []
							: [inArray(column(workout, "id"), input.workoutIds.map(literal))]),
					),
					selection: {
						volume: workoutVolume(workout),
						id: selectedField(column(workout, "id"), Schema.String),
						setCount: selectedField(totals.setCount, Schema.Finite),
						name: selectedField(column(workout, "name"), Schema.String),
						startedAt: selectedField(startedAt(workout), nullableString),
						exerciseCount: selectedField(totals.exerciseCount, Schema.Finite),
						processing: selectedField(totals.processing, ProjectionProcessing),
						personalBests: selectedField(totals.personalBests, NullableNumber),
						endedAt: selectedField(propertyDate(workout, "endedAt"), nullableString),
						repeatedFromId: selectedField(repeatedFromId(workout, input.reference), nullableString),
						activeDuration: selectedField(
							propertyNumber(workout, "activeDuration"),
							NullableNumber,
						),
						previousTemplateWorkoutId: selectedField(
							previousTemplateWorkoutId(workout, input.reference),
							nullableString,
						),
					},
				}),
			},
		};
	},
);

export const workoutCountRecipe = defineRecipe(
	(input: {
		readonly search: string;
		readonly reference: Reference;
		readonly filter?: undefined | WorkoutFilterPredicate;
	}) => {
		const workout = table("entity", LIST_WORKOUT_ALIAS);
		return {
			map: ({ total }) => Result.succeed(total.workouts),
			queries: {
				total: selectedAggregate(workout, {
					measures: { workouts: countAll },
					where: workoutWhere(workout, input.reference, input.search, input.filter),
				}),
			},
		};
	},
);

export const workoutComparisonsRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly workoutIds: readonly string[] }) => {
		const workout = table("entity", "workout");
		return {
			map: ({ workouts }) => Result.succeed(workouts.items),
			queries: {
				workouts: selectedRows(workout, {
					limit: input.workoutIds.length,
					orderBy: [ascending(column(workout, "id"))],
					where: and(
						entitySchemaPredicate(workout, "workout", input.reference),
						inArray(column(workout, "id"), input.workoutIds.map(literal)),
					),
					selection: {
						volume: workoutVolume(workout),
						id: selectedField(column(workout, "id"), Schema.String),
						startedAt: selectedField(startedAt(workout), nullableString),
					},
				}),
			},
		};
	},
);

export const workoutExerciseTargetsRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly exerciseIds: readonly string[] }) => {
		const exercise = table("entity", "exercise");
		return {
			map: ({ exercises }) =>
				Result.succeed(exercises.items.map(({ id, targets }) => ({ id, targets: targets.items }))),
			queries: {
				exercises: selectedRows(exercise, {
					limit: input.exerciseIds.length,
					orderBy: [ascending(column(exercise, "id"))],
					include: { targets: exerciseTargetInclude(exercise) },
					selection: { id: selectedField(column(exercise, "id"), Schema.String) },
					where: and(
						entitySchemaPredicate(exercise, "exercise", input.reference),
						inArray(column(exercise, "id"), input.exerciseIds.map(literal)),
					),
				}),
			},
		};
	},
);

export const workoutMeasures = (workout: Table) => ({
	workouts: countAll,
	activeDuration: sumOf(propertyNumber(workout, "activeDuration")),
	timedWorkouts: countIf(isNotNull(propertyNumber(workout, "activeDuration"))),
});

export const setMeasures = (set: Table) => ({
	volume: sumOf(workoutSetVolume(set)),
	personalBests: sumOf(personalBestAwardCount(set)),
});

export const workoutRangeSources = (
	reference: Reference,
	range: null | Range,
	alias: string,
	search = "",
	filter?: WorkoutFilterPredicate,
) => {
	const workout = table("entity", rangeWorkoutAlias(alias));
	const set = table("event", `${alias}Set`);
	const occurrence = table("event", `${alias}Occurrence`);
	const workouts = workoutWhere(workout, reference, search, filter);
	return {
		set,
		workout,
		occurrence,
		setStartedAt: column(occurrence, "occurredAt"),
		workoutWhere: and(workouts, withinPeriod(startedAt(workout), range)),
		setWhere: and(
			schemaOwnerPredicate(set, "eventSchemaPluginId", reference),
			eq(column(set, "eventSchemaSlug"), literal("workout-set")),
		),
		setJoins: [
			join(
				"inner",
				occurrence,
				and(
					eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
					occurrenceSets(set, occurrence),
					withinPeriod(column(occurrence, "occurredAt"), range),
				),
			),
			join(
				"inner",
				workout,
				and(eq(column(set, "sessionEntityId"), column(workout, "id")), workouts),
			),
		],
	};
};

const rangeTotals = (reference: Reference, range: Range, alias: string) => {
	const sources = workoutRangeSources(reference, range, alias);
	return [
		selectedAggregate(sources.workout, {
			where: sources.workoutWhere,
			measures: workoutMeasures(sources.workout),
		}),
		selectedAggregate(sources.set, {
			joins: sources.setJoins,
			where: sources.setWhere,
			measures: setMeasures(sources.set),
		}),
	] as const;
};

const rangeBuckets = (
	reference: Reference,
	range: Range & {
		readonly search: string;
		readonly timeZone: TimeZone;
		readonly bucket: "day" | "week";
		readonly filter?: undefined | WorkoutFilterPredicate;
	},
	alias: string,
) => {
	const sources = workoutRangeSources(reference, range, alias, range.search, range.filter);
	const groupBy = (at: Parameters<typeof dateBucket>[0]) => ({
		at: selectedField(
			dateBucket(at, { bucket: range.bucket, timeZone: range.timeZone }),
			IsoDateString,
		),
	});
	return [
		selectedAggregate(sources.workout, {
			limit: 400,
			where: sources.workoutWhere,
			orderBy: [groupAscending("at")],
			measures: workoutMeasures(sources.workout),
			groupBy: groupBy(startedAt(sources.workout)),
		}),
		selectedAggregate(sources.set, {
			limit: 400,
			joins: sources.setJoins,
			where: sources.setWhere,
			orderBy: [groupAscending("at")],
			measures: setMeasures(sources.set),
			groupBy: groupBy(sources.setStartedAt),
		}),
	] as const;
};

type SetTotals = SelectedMeasureRow<ReturnType<typeof setMeasures>>;
type WorkoutTotals = SelectedMeasureRow<ReturnType<typeof workoutMeasures>>;

const combineTotals = (workouts: WorkoutTotals, sets: SetTotals, ready: boolean) => ({
	...workouts,
	activeDuration: workouts.activeDuration,
	volume: ready ? (sets.volume ?? 0) : null,
	timedWorkouts: workouts.timedWorkouts ?? 0,
	personalBests: ready ? (sets.personalBests ?? 0) : null,
});

const combineBuckets = (
	workouts: { readonly items: readonly (WorkoutTotals & { readonly at: string })[] },
	sets: { readonly items: readonly (SetTotals & { readonly at: string })[] },
	ready: boolean,
) => {
	const setTotals = new Map(sets.items.map((item) => [item.at, item]));
	return workouts.items.map(({ at, ...item }) => ({
		at,
		...combineTotals(item, setTotals.get(at) ?? { volume: null, personalBests: null }, ready),
	}));
};

export const workoutWeeksRecipe = defineRecipe(
	(
		input: Range & {
			readonly search: string;
			readonly timeZone: TimeZone;
			readonly reference: Reference;
			readonly filter?: undefined | WorkoutFilterPredicate;
		},
	) => {
		const [workouts, sets] = rangeBuckets(
			input.reference,
			{ ...input, bucket: "week" },
			WEEKS_ALIAS,
		);
		return {
			queries: { sets, workouts, processing: workoutSetProcessing(input.reference) },
			map: (results) =>
				Result.succeed(
					combineBuckets(
						results.workouts,
						results.sets,
						projectionProcessingState(results.processing) === "ready",
					),
				),
		};
	},
);

const latestRecordQuery = (reference: Reference, range: Range) => {
	const sources = workoutRangeSources(reference, range, "record");
	const exercise = table("entity", "recordExercise");
	return selectedRows(sources.set, {
		limit: 1,
		orderBy: [descending(column(sources.set, "occurredAt")), descending(column(sources.set, "id"))],
		where: and(sources.setWhere, jsonArrayExists(projectionProperty(sources.set, "personalBests"))),
		joins: [
			...sources.setJoins,
			join("inner", exercise, eq(column(sources.set, "entityId"), column(exercise, "id"))),
		],
		selection: {
			exerciseName: selectedField(column(exercise, "name"), Schema.String),
			reps: selectedField(propertyNumber(sources.set, "reps"), NullableNumber),
			weight: selectedField(propertyNumber(sources.set, "weight"), NullableNumber),
			distance: selectedField(propertyNumber(sources.set, "distance"), NullableNumber),
			duration: selectedField(propertyNumber(sources.set, "duration"), NullableNumber),
			exerciseKind: selectedField(property(sources.set, "exerciseKind"), exerciseKindSchema),
		},
	});
};

export const workoutSummaryRecipe = defineRecipe(
	(input: {
		readonly days: Range;
		readonly current: Range;
		readonly previous: Range;
		readonly timeZone: TimeZone;
		readonly reference: Reference;
	}) => {
		const [currentWorkouts, currentSets] = rangeTotals(input.reference, input.current, "current");
		const [previousWorkouts, previousSets] = rangeTotals(
			input.reference,
			input.previous,
			"previous",
		);
		const [dayWorkouts, daySets] = rangeBuckets(
			input.reference,
			{ ...input.days, search: "", bucket: "day", timeZone: input.timeZone },
			"days",
		);
		return {
			queries: {
				daySets,
				currentSets,
				dayWorkouts,
				previousSets,
				currentWorkouts,
				previousWorkouts,
				processing: workoutSetProcessing(input.reference),
				latestRecord: latestRecordQuery(input.reference, input.current),
			},
			map: (results) => {
				const ready = projectionProcessingState(results.processing) === "ready";
				return Result.succeed({
					days: combineBuckets(results.dayWorkouts, results.daySets, ready),
					latestRecord: ready ? (results.latestRecord.items[0] ?? null) : null,
					current: combineTotals(results.currentWorkouts, results.currentSets, ready),
					previous: combineTotals(results.previousWorkouts, results.previousSets, ready),
				});
			},
		};
	},
);

export type WorkoutSummary = Recipe.Success<typeof workoutSummaryRecipe>;
export type WorkoutPeriodTotals = Recipe.Success<typeof workoutWeeksRecipe>[number];
export type WorkoutComparison = Recipe.Success<typeof workoutComparisonsRecipe>[number];
export type WorkoutListItem = Recipe.Success<typeof workoutCardsRecipe>["items"][number];
export type WorkoutExerciseTargets = Recipe.Success<typeof workoutExerciseTargetsRecipe>[number];

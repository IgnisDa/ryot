import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	conditional,
	contains,
	count,
	countDistinct,
	dateBucket,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	first,
	groupAscending,
	gte,
	inArray,
	isNotNull,
	IsoDateString,
	join,
	jsonArrayCount,
	jsonArrayExists,
	literal,
	lt,
	type Recipe,
	relationshipSchemaPredicate,
	rows,
	schemaOwnerPredicate,
	selectedAggregate,
	type SelectedAggregateRow,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedRows,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	projectionNumber,
	projectionProperty,
	property,
	propertyDate,
	propertyNumber,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { workoutTemplateInclude } from "./query-recipes";
import { exerciseTargetInclude } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";

type Table = ReturnType<typeof table>;
type Reference = PluginIdentityReference;
type Range = { readonly startAt: string; readonly endAt: string };
export type WorkoutFilterPredicate = ReturnType<typeof and>;

export const WORKOUT_LIST_PAGE_SIZE = 20;

const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const templateSlug = "workout-to-workout-template";

export const startedAt = (workout: Table) => propertyDate(workout, "startedAt");

const workoutSets = (set: Table, workout: Table) =>
	and(
		eq(column(set, "sessionEntityId"), column(workout, "id")),
		eq(column(set, "eventSchemaPluginId"), column(workout, "entitySchemaPluginId")),
		eq(column(set, "eventSchemaSlug"), literal("workout-set")),
	);

const personalBestCount = (set: Table) => jsonArrayCount(projectionProperty(set, "personalBests"));

export const workoutTotals = (workout: Table, setAlias: string) => {
	const set = table("event", setAlias);
	const sets = workoutSets(set, workout);
	return {
		setCount: count(set, { where: sets }),
		personalBests: sum(set, personalBestCount(set), { where: sets }),
		exerciseCount: countDistinct(set, column(set, "entityId"), { where: sets }),
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

const inRange = (workout: Table, range: Range) =>
	and(
		gte(startedAt(workout), castDate(literal(range.startAt))),
		lt(startedAt(workout), castDate(literal(range.endAt))),
	);

const workoutVolume = (workout: Table) => {
	const set = table("event", "volumeWorkoutSet");
	return selectedField(
		sum(set, projectionNumber(set, "volume"), { where: workoutSets(set, workout) }),
		nullableNumber,
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
			reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
			exerciseId: selectedField(column(exercise, "id"), Schema.String),
			oneRm: selectedField(projectionNumber(set, "oneRm"), nullableNumber),
			weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
			exerciseName: selectedField(column(exercise, "name"), Schema.String),
			setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
			duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
			distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
			exerciseKind: selectedField(property(set, "exerciseKind"), exerciseKindSchema),
			exerciseOrder: selectedField(propertyNumber(set, "exerciseOrder"), nullableNumber),
			personalBests: selectedField(
				projectionProperty(set, "personalBests"),
				Schema.NullOr(Schema.Array(PersonalBestSchema)),
			),
		},
	});
};

export const workoutCardsRecipe = defineRecipe(
	(input: {
		readonly reference: Reference;
		readonly search: string;
		readonly limit?: number | undefined;
		readonly after?: string | undefined;
		readonly filter?: WorkoutFilterPredicate | undefined;
		readonly workoutIds?: readonly string[] | undefined;
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
						personalBests: selectedField(totals.personalBests, nullableNumber),
						endedAt: selectedField(propertyDate(workout, "endedAt"), nullableString),
						repeatedFromId: selectedField(repeatedFromId(workout, input.reference), nullableString),
						activeDuration: selectedField(
							propertyNumber(workout, "activeDuration"),
							nullableNumber,
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
		readonly filter?: WorkoutFilterPredicate | undefined;
	}) => {
		const workout = table("entity", LIST_WORKOUT_ALIAS);
		return {
			map: ({ total }) => Result.succeed(total.workouts),
			queries: {
				total: selectedAggregate(workout, {
					where: workoutWhere(workout, input.reference, input.search, input.filter),
					measures: { workouts: selectedMeasure({ function: "count" }, Schema.Finite) },
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

const sumMeasure = (expr: Parameters<typeof conditional>[1]) =>
	selectedMeasure({ expr, function: "sum" }, nullableNumber);

const workoutMeasures = (workout: Table) => ({
	workouts: selectedMeasure({ function: "count" }, Schema.Finite),
	activeDuration: sumMeasure(propertyNumber(workout, "activeDuration")),
	timedWorkouts: sumMeasure(
		conditional(isNotNull(propertyNumber(workout, "activeDuration")), literal(1), literal(0)),
	),
});

const setMeasures = (set: Table) => ({
	personalBests: sumMeasure(personalBestCount(set)),
	volume: sumMeasure(projectionNumber(set, "volume")),
});

const rangeSources = (
	reference: Reference,
	range: Range,
	alias: string,
	search = "",
	filter?: WorkoutFilterPredicate,
) => {
	const workout = table("entity", rangeWorkoutAlias(alias));
	const set = table("event", `${alias}Set`);
	const workouts = and(workoutWhere(workout, reference, search, filter), inRange(workout, range));
	return {
		set,
		workout,
		workoutWhere: workouts,
		setJoins: [join("inner", workout, eq(column(set, "sessionEntityId"), column(workout, "id")))],
		setWhere: and(
			schemaOwnerPredicate(set, "eventSchemaPluginId", reference),
			eq(column(set, "eventSchemaSlug"), literal("workout-set")),
			workouts,
		),
	};
};

const rangeTotals = (reference: Reference, range: Range, alias: string) => {
	const sources = rangeSources(reference, range, alias);
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
		readonly timeZone: string;
		readonly bucket: "day" | "week";
		readonly filter?: WorkoutFilterPredicate | undefined;
	},
	alias: string,
) => {
	const sources = rangeSources(reference, range, alias, range.search, range.filter);
	const groupBy = (workout: Table) => ({
		at: selectedField(
			dateBucket(startedAt(workout), { bucket: range.bucket, timeZone: range.timeZone }),
			IsoDateString,
		),
	});
	return [
		selectedAggregate(sources.workout, {
			limit: 400,
			where: sources.workoutWhere,
			orderBy: [groupAscending("at")],
			groupBy: groupBy(sources.workout),
			measures: workoutMeasures(sources.workout),
		}),
		selectedAggregate(sources.set, {
			limit: 400,
			joins: sources.setJoins,
			where: sources.setWhere,
			orderBy: [groupAscending("at")],
			groupBy: groupBy(sources.workout),
			measures: setMeasures(sources.set),
		}),
	] as const;
};

type WorkoutTotals = SelectedAggregateRow<Record<never, never>, ReturnType<typeof workoutMeasures>>;
type SetTotals = SelectedAggregateRow<Record<never, never>, ReturnType<typeof setMeasures>>;

const combineTotals = (workouts: WorkoutTotals, sets: SetTotals) => ({
	...workouts,
	volume: sets.volume ?? 0,
	personalBests: sets.personalBests ?? 0,
	timedWorkouts: workouts.timedWorkouts ?? 0,
	activeDuration: workouts.activeDuration ?? 0,
});

const combineBuckets = (
	workouts: { readonly items: readonly (WorkoutTotals & { readonly at: string })[] },
	sets: { readonly items: readonly (SetTotals & { readonly at: string })[] },
) => {
	const setTotals = new Map(sets.items.map((item) => [item.at, item]));
	return workouts.items.map(({ at, ...item }) => ({
		at,
		...combineTotals(item, setTotals.get(at) ?? { volume: null, personalBests: null }),
	}));
};

export const workoutWeeksRecipe = defineRecipe(
	(
		input: {
			readonly search: string;
			readonly timeZone: string;
			readonly reference: Reference;
			readonly filter?: WorkoutFilterPredicate | undefined;
		} & Range,
	) => {
		const [workouts, sets] = rangeBuckets(
			input.reference,
			{ ...input, bucket: "week" },
			WEEKS_ALIAS,
		);
		return {
			queries: { sets, workouts },
			map: (results) => Result.succeed(combineBuckets(results.workouts, results.sets)),
		};
	},
);

const latestRecordQuery = (reference: Reference, range: Range) => {
	const sources = rangeSources(reference, range, "record");
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
			reps: selectedField(propertyNumber(sources.set, "reps"), nullableNumber),
			weight: selectedField(propertyNumber(sources.set, "weight"), nullableNumber),
			distance: selectedField(propertyNumber(sources.set, "distance"), nullableNumber),
			duration: selectedField(propertyNumber(sources.set, "duration"), nullableNumber),
			exerciseKind: selectedField(property(sources.set, "exerciseKind"), exerciseKindSchema),
		},
	});
};

export const workoutSummaryRecipe = defineRecipe(
	(input: {
		readonly reference: Reference;
		readonly timeZone: string;
		readonly current: Range;
		readonly previous: Range;
		readonly days: Range;
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
				latestRecord: latestRecordQuery(input.reference, input.current),
			},
			map: (results) =>
				Result.succeed({
					latestRecord: results.latestRecord.items[0] ?? null,
					days: combineBuckets(results.dayWorkouts, results.daySets),
					current: combineTotals(results.currentWorkouts, results.currentSets),
					previous: combineTotals(results.previousWorkouts, results.previousSets),
				}),
		};
	},
);

export type WorkoutListItem = Recipe.Success<typeof workoutCardsRecipe>["items"][number];
export type WorkoutComparison = Recipe.Success<typeof workoutComparisonsRecipe>[number];
export type WorkoutExerciseTargets = Recipe.Success<typeof workoutExerciseTargetsRecipe>[number];
export type WorkoutPeriodTotals = Recipe.Success<typeof workoutWeeksRecipe>[number];
export type WorkoutSummary = Recipe.Success<typeof workoutSummaryRecipe>;

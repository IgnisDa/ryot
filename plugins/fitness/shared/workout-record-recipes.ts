import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	defineRecipe,
	eq,
	foldSubjectEventPredicate,
	gt,
	gte,
	inArray,
	IsoDateString,
	join,
	literal,
	lte,
	not,
	or,
	parameters,
	type Predicate,
	type ScalarExpression,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { projectionNumber, property, propertyDate, propertyNumber } from "./entity-selections";
import { type ExerciseKind, exerciseKindSchema } from "./exercise-kinds";
import { catalogMessage } from "./messages.generated";
import {
	exerciseFoldEventSchemaSlugs,
	type PersonalBest,
	personalBestTypes,
} from "./workout-records";

const workoutRecordPageSize = 100;
const unorderedLast = 2147483647;
const boundTolerance = 0.001;

/** Sets after `from` whose personal-best candidate may lie in one of `bounds`; callers recheck exactly. */
export type WorkoutRecordRange = {
	readonly from: string;
	readonly excluded: ReadonlyArray<string>;
	readonly bounds: ReadonlyArray<{
		readonly above: number;
		readonly atMost: number;
		readonly kind: ExerciseKind;
		readonly type: PersonalBest;
	}>;
};

type Table = Parameters<typeof column>[0];

const candidateExpressions: Record<
	PersonalBest,
	(event: Table) => ReturnType<typeof propertyNumber>
> = {
	reps: (event) => propertyNumber(event, "reps"),
	pace: (event) => projectionNumber(event, "pace"),
	time: (event) => propertyNumber(event, "duration"),
	weight: (event) => propertyNumber(event, "weight"),
	one_rm: (event) => projectionNumber(event, "oneRm"),
	volume: (event) => projectionNumber(event, "volume"),
	distance: (event) => propertyNumber(event, "distance"),
};

const candidateExpression = (event: Table, type: PersonalBest) => candidateExpressions[type](event);

const fitnessFolds = [
	{ entitySchemaSlug: "exercise", eventSchemaSlugs: exerciseFoldEventSchemaSlugs },
];

const self = { kind: "self" } as const;
const event = table("event", "workoutRecord");
const exercise = table("entity", "exercise");
const workout = table("entity", "workout");

const exerciseParameter = {
	type: "string",
	validation: { required: true },
	description: "Exercise Id for this selection",
	label: catalogMessage("query-parameter.exercise"),
} as const;

const recordRows = (exerciseId: ScalarExpression, range?: Predicate) =>
	selectedRows(event, {
		limit: workoutRecordPageSize,
		joins: [
			join("inner", exercise, eq(column(event, "entityId"), column(exercise, "id"))),
			join("inner", workout, eq(column(event, "sessionEntityId"), column(workout, "id"))),
		],
		orderBy: [
			ascending(column(event, "occurredAt")),
			ascending(propertyDate(workout, "startedAt")),
			ascending(column(event, "sessionEntityId")),
			ascending(coalesce(propertyNumber(event, "exerciseOrder"), literal(unorderedLast))),
			ascending(coalesce(propertyNumber(event, "setOrder"), literal(unorderedLast))),
			ascending(column(event, "id")),
		],
		where: and(
			schemaOwnerPredicate(exercise, "entitySchemaPluginId", self),
			schemaOwnerPredicate(workout, "entitySchemaPluginId", self),
			foldSubjectEventPredicate(event, {
				folds: fitnessFolds,
				subject: exerciseId,
				eventSchemaSlugs: exerciseFoldEventSchemaSlugs,
			}),
			eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
			eq(column(workout, "entitySchemaSlug"), literal("workout")),
			...(range === undefined ? [] : [range]),
		),
		selection: {
			id: selectedField(column(event, "id"), EventId),
			occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
			sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.String),
			exerciseKind: selectedField(property(event, "exerciseKind"), exerciseKindSchema),
			reps: selectedField(propertyNumber(event, "reps"), Schema.NullOr(Schema.Finite)),
			weight: selectedField(propertyNumber(event, "weight"), Schema.NullOr(Schema.Finite)),
			setOrder: selectedField(propertyNumber(event, "setOrder"), Schema.NullOr(Schema.Finite)),
			duration: selectedField(propertyNumber(event, "duration"), Schema.NullOr(Schema.Finite)),
			distance: selectedField(propertyNumber(event, "distance"), Schema.NullOr(Schema.Finite)),
			startedAt: selectedField(propertyDate(workout, "startedAt"), Schema.NullOr(IsoDateString)),
			exerciseOrder: selectedField(
				propertyNumber(event, "exerciseOrder"),
				Schema.NullOr(Schema.Finite),
			),
		},
	});

/** One exercise's sets in record order. */
export const workoutRecordsRecipe = (() => {
	const inputParameters = parameters({ fields: { exerciseId: exerciseParameter } });
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ records }) => Result.succeed(records),
		queries: { records: recordRows(inputParameters.value("exerciseId")) },
	});
})();

const bound = {
	type: "number",
	defaultValue: 0,
	description: "Personal-best candidate bound",
	label: catalogMessage("query-parameter.value"),
} as const;

/**
 * One exercise's sets after `from`, other than `excluded`, whose candidate for a record type lies in
 * that type's `(above, atMost]`; a type left at its defaults matches no set.
 */
export const workoutRecordRangeRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			timeAbove: bound,
			paceAbove: bound,
			repsAbove: bound,
			timeAtMost: bound,
			paceAtMost: bound,
			repsAtMost: bound,
			one_rmAbove: bound,
			volumeAbove: bound,
			weightAbove: bound,
			one_rmAtMost: bound,
			volumeAtMost: bound,
			weightAtMost: bound,
			distanceAbove: bound,
			distanceAtMost: bound,
			exerciseId: exerciseParameter,
			from: {
				type: "datetime",
				validation: { required: true },
				description: "Earliest set to read",
				label: catalogMessage("query-parameter.from"),
			},
			excluded: {
				type: "array",
				description: "Sets to leave out",
				label: catalogMessage("query-parameter.events"),
				items: {
					type: "string",
					description: "Set ID",
					label: catalogMessage("query-parameter.value"),
				},
			},
		},
	});
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ records }) => Result.succeed(records),
		queries: {
			records: recordRows(
				inputParameters.value("exerciseId"),
				and(
					gte(column(event, "occurredAt"), inputParameters.value("from")),
					inputParameters.whenSet(
						"excluded",
						not(inArray(column(event, "id"), inputParameters.list("excluded"))),
					),
					or(
						...personalBestTypes.map((type) =>
							and(
								gt(candidateExpression(event, type), inputParameters.value(`${type}Above`)),
								lte(candidateExpression(event, type), inputParameters.value(`${type}AtMost`)),
							),
						),
					),
				),
			),
		},
	});
})();

/** The range read's arguments: each record type's widest bound across kinds, widened by a tolerance. */
export const workoutRecordRangeArguments = (range: WorkoutRecordRange) => {
	const bounds = new Map<PersonalBest, { above: number; atMost: number }>();
	for (const { type, above, atMost } of range.bounds) {
		const known = bounds.get(type);
		bounds.set(type, {
			above: Math.min(above, known?.above ?? above),
			atMost: Math.max(atMost, known?.atMost ?? atMost),
		});
	}
	return {
		from: range.from,
		...(range.excluded.length === 0 ? {} : { excluded: range.excluded }),
		...Object.fromEntries(
			[...bounds].flatMap(([type, { above, atMost }]) => [
				[`${type}Above`, above - boundTolerance],
				[`${type}AtMost`, atMost + boundTolerance],
			]),
		),
	};
};

/** The start of each listed workout, as the record order reads it. */
export const workoutStartsRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			workoutIds: {
				type: "array",
				validation: { required: true },
				description: "Workout Ids for this selection",
				label: catalogMessage("query-parameter.workouts"),
				items: {
					type: "string",
					description: "Selection value",
					label: catalogMessage("query-parameter.value"),
				},
			},
		},
	});
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ workouts }) => Result.succeed(workouts),
		queries: {
			workouts: selectedRows(workout, {
				limit: workoutRecordPageSize,
				orderBy: [ascending(column(workout, "id"))],
				selection: {
					id: selectedField(column(workout, "id"), Schema.String),
					startedAt: selectedField(
						propertyDate(workout, "startedAt"),
						Schema.NullOr(IsoDateString),
					),
				},
				where: and(
					schemaOwnerPredicate(workout, "entitySchemaPluginId", self),
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
					inArray(column(workout, "id"), inputParameters.list("workoutIds")),
				),
			}),
		},
	});
})();
